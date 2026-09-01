from __future__ import annotations

import time
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.rag.ingest import ingest_rag_docs
from app.services.recommendation_service import recommend_panels
from app.tools.brief_utils import brief_to_scoring_criteria
from app.tools.brief_tool import brief_extraction_tool
from app.tools.panel_copy_tool import enrich_recommendation_explanations
from app.tools.rag_tool import rag_tool
from app.llm.router import routing_label
from app.llm.throttle import mark_agent_finished
from app.llm.usage import get_groq_usage, reset_groq_usage


class AgentState(TypedDict, total=False):
    message: str
    conversation: str
    is_conversation: bool
    prior_criteria: dict[str, Any]
    brief: dict[str, Any]
    brief_source: str
    scoring_criteria: dict[str, Any]
    recommendation: dict[str, Any]
    rag: dict[str, Any]
    panel_copy_ok: bool


def _brief_node(state: AgentState) -> AgentState:
    from app.services.chat_service import _merge_followup_criteria

    conv = state.get("conversation") or state["message"]
    is_conv = bool(state.get("is_conversation"))
    try:
        brief_out = brief_extraction_tool(
            conv,
            latest_message=state["message"],
            is_conversation=is_conv,
        )
        return {**state, "brief": brief_out["brief"], "brief_source": "llm_8b"}
    except Exception:
        return {
            **state,
            "brief": _merge_followup_criteria(
                state["message"], state.get("prior_criteria")
            ),
            "brief_source": "heuristic_fallback",
        }


def _recommendation_node(state: AgentState) -> AgentState:
    criteria = brief_to_scoring_criteria(
        state.get("brief") or {},
        state.get("message") or "",
    )
    rec = recommend_panels(criteria)
    brief = state.get("brief") or {}
    q = (
        "Règles métier DOOH premium et contraintes planning. "
        f"Contexte: city={brief.get('city')}, cities={brief.get('cities')}, target={brief.get('target')}, "
        f"objective={brief.get('objective')}, poi={brief.get('poi')}."
    )
    try:
        rag = rag_tool(q, k=3, summarize=False)
    except Exception:
        rag = {"query": q, "k": 3, "matches": [], "error": "rag_unavailable"}
    return {**state, "recommendation": rec, "scoring_criteria": criteria, "rag": rag}


def _panel_copy_node(state: AgentState) -> AgentState:
    """Justifications uniques par panneau via LLM (Groq/OpenAI)."""
    rec = state.get("recommendation") or {}
    rag = state.get("rag") or {}
    matches = rag.get("matches") or []
    try:
        new_rec, ok = enrich_recommendation_explanations(
            state.get("message") or "",
            state.get("brief") or {},
            matches,
            rec,
            rag_summary=(rag.get("summary") if isinstance(rag, dict) else None),
        )
        return {**state, "recommendation": new_rec, "panel_copy_ok": ok}
    except Exception:
        return {**state, "panel_copy_ok": False}


def build_agent():
    g = StateGraph(AgentState)
    g.add_node("brief", _brief_node)
    g.add_node("recommendation", _recommendation_node)
    g.add_node("panel_copy", _panel_copy_node)

    g.set_entry_point("brief")
    g.add_edge("brief", "recommendation")
    g.add_edge("recommendation", "panel_copy")
    g.add_edge("panel_copy", END)
    return g.compile()


AGENT = build_agent()


def _build_conversation_text(
    history: list[dict[str, Any]] | None, message: str
) -> tuple[str, bool]:
    """Concatène les demandes successives du client pour un brief cumulé.
    Retourne (texte, is_conversation)."""
    user_turns: list[str] = []
    for turn in history or []:
        if (turn.get("role") or "") == "user":
            content = (turn.get("content") or "").strip()
            if content:
                user_turns.append(content)

    if not user_turns:
        return message, False

    lines = [f"Demande {i + 1}: {t}" for i, t in enumerate(user_turns)]
    lines.append(f"Demande {len(user_turns) + 1} (la plus récente): {message.strip()}")
    return "\n".join(lines), True


def run_agent(
    message: str,
    history: list[dict[str, Any]] | None = None,
    prior_criteria: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reset_groq_usage()
    started = time.time()
    try:
        ingest_rag_docs()
    except Exception:
        pass

    conversation, is_conv = _build_conversation_text(history, message)
    out = AGENT.invoke(
        {
            "message": message,
            "conversation": conversation,
            "is_conversation": is_conv,
            "prior_criteria": prior_criteria,
        }
    )
    total_s = round(time.time() - started, 1)
    brief = out.get("brief") or {}
    criteria = out.get("scoring_criteria") or brief
    from app.config.settings import get_settings

    settings = get_settings()
    provider = "groq" if settings.groq_api_key else "openai"
    panel_copy_ok = bool(out.get("panel_copy_ok"))
    rec = out.get("recommendation") or {}
    results = rec.get("results") or []
    llm_expl_count = int(rec.get("llm_explanations_count") or 0)
    llm_target = int(rec.get("llm_explanations_target") or len(results))
    partial = 0 < llm_expl_count < llm_target
    mostly_llm = llm_expl_count >= llm_target
    expl_src = (
        "llm_groq"
        if mostly_llm
        else ("llm_groq_partial" if partial else "llm_unavailable")
    )

    routes = routing_label(settings)
    panel_model = rec.get("groq_panel_primary_model") or settings.groq_model_fast
    groq_usage = get_groq_usage()

    meta: dict[str, Any] = {
        "llm_used": True,
        "llm_provider": provider,
        "groq_routing": routes,
        "groq_model": panel_model,
        "groq_model_fast": settings.groq_model_fast,
        "brief_source": out.get("brief_source") or "llm_8b",
        "rag_model": routes["rag"],
        "panel_copy_model": panel_model,
        "panel_explanations_8b": llm_expl_count,
        "groq_api_calls": groq_usage.get("groq_api_calls", 0),
        "groq_rate_limit_hits": groq_usage.get("groq_rate_limit_hits", 0),
        "duration_total_sec": total_s,
        "duration_panel_copy_sec": rec.get("panel_copy_duration_s"),
        "latency_note": (
            f"~{total_s}s — tout en {settings.groq_model_fast} "
            f"({llm_expl_count}/{llm_target} textes). "
            f"{groq_usage.get('groq_api_calls', 0)} appels Groq."
        ),
        "recommendation_source": "scoring_engine",
        "explanation_source": expl_src,
        "panel_copy_llm": mostly_llm,
        "panel_explanations_llm_count": llm_expl_count,
        "panel_explanations_total": llm_target,
        "llm_ssl_verify": not settings.llm_skip_ssl_verify,
        "llm_tls_mode": "verified" if not settings.llm_skip_ssl_verify else "docker_network",
    }
    if partial:
        meta["panel_copy_partial"] = True
        meta["hint"] = (
            f"{llm_expl_count}/{llm_target} textes ({panel_model}). "
            "Relancez après 1 min si quota Groq (429)."
        )
    elif llm_target > 0 and llm_expl_count >= llm_target:
        meta["hint"] = f"Plan complet {llm_target}/{llm_target} — {panel_model}."
    elif llm_expl_count == 0 and llm_target > 0:
        calls = groq_usage.get("groq_api_calls", 0)
        meta["hint"] = (
            f"Aucun texte ({panel_model}). Appels Groq : {calls}. "
            "Quota saturé — attendez 2 min puis relancez."
        )

    from app.services.chat_service import build_assistant_reply

    extra_note = None
    if partial:
        extra_note = (
            f"J'ai rédigé {llm_expl_count}/{llm_target} justifications pour l'instant "
            "(quota Groq) — relance dans ~1 min pour compléter."
        )
    assistant_message = build_assistant_reply(
        criteria, rec, prior_criteria=prior_criteria, extra_note=extra_note
    )

    mark_agent_finished()

    return {
        "assistant_message": assistant_message,
        "extracted_criteria": criteria,
        "rag": out.get("rag"),
        "recommendation": rec,
        "meta": meta,
    }
