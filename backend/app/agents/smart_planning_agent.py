from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.rag.ingest import ingest_rag_docs
from app.services.recommendation_service import recommend_panels
from app.tools.brief_utils import brief_to_scoring_criteria
from app.tools.brief_tool import brief_extraction_tool
from app.tools.panel_copy_tool import enrich_recommendation_explanations
from app.tools.rag_tool import rag_tool
from app.llm.throttle import mark_agent_finished


class AgentState(TypedDict, total=False):
    message: str
    brief: dict[str, Any]
    scoring_criteria: dict[str, Any]
    recommendation: dict[str, Any]
    rag: dict[str, Any]
    panel_copy_ok: bool


def _brief_node(state: AgentState) -> AgentState:
    from app.config.settings import get_settings
    from app.services.chat_service import _fallback_extract_criteria

    settings = get_settings()
    # 8b : 1 seul slot LLM économisé pour les textes panneaux (évite 429 tokens/min)
    if "8b-instant" in (settings.groq_model or ""):
        return {**state, "brief": _fallback_extract_criteria(state["message"])}

    try:
        brief_out = brief_extraction_tool(state["message"])
        return {**state, "brief": brief_out["brief"]}
    except Exception:
        return {**state, "brief": _fallback_extract_criteria(state["message"])}


def _recommendation_node(state: AgentState) -> AgentState:
    criteria = brief_to_scoring_criteria(
        state.get("brief") or {},
        state.get("message") or "",
    )
    rec = recommend_panels(criteria)
    return {**state, "recommendation": rec, "scoring_criteria": criteria}


def _rag_node(state: AgentState) -> AgentState:
    brief = state.get("brief") or {}
    q = (
        "Règles métier DOOH premium et contraintes planning. "
        f"Contexte: city={brief.get('city')}, cities={brief.get('cities')}, target={brief.get('target')}, "
        f"objective={brief.get('objective')}, poi={brief.get('poi')}."
    )
    try:
        rag = rag_tool(q, k=4)
    except Exception:
        rag = {"query": q, "k": 4, "matches": [], "error": "rag_unavailable"}
    return {**state, "rag": rag}


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
        )
        return {**state, "recommendation": new_rec, "panel_copy_ok": ok}
    except Exception:
        return {**state, "panel_copy_ok": False}


def build_agent():
    g = StateGraph(AgentState)
    g.add_node("brief", _brief_node)
    g.add_node("recommendation", _recommendation_node)
    g.add_node("rag", _rag_node)
    g.add_node("panel_copy", _panel_copy_node)

    g.set_entry_point("brief")
    g.add_edge("brief", "recommendation")
    g.add_edge("recommendation", "rag")
    g.add_edge("rag", "panel_copy")
    g.add_edge("panel_copy", END)
    return g.compile()


AGENT = build_agent()


def run_agent(message: str) -> dict[str, Any]:
    try:
        ingest_rag_docs()
    except Exception:
        pass

    out = AGENT.invoke({"message": message})
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

    meta: dict[str, Any] = {
        "llm_used": True,
        "llm_provider": provider,
        "groq_model": settings.groq_model,
        "brief_source": (
            "heuristic" if "8b-instant" in (settings.groq_model or "") else "llm"
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
            f"Groq ({settings.groq_model}) : {llm_expl_count}/{llm_target} textes IA — "
            "relancez la génération pour compléter (mode LLM uniquement, pas de texte modèle)."
        )
    elif llm_expl_count == 0 and llm_target > 0:
        meta["hint"] = (
            f"Aucun texte généré par {settings.groq_model} (quota journalier Groq souvent épuisé). "
            "Les panneaux sont scorés mais les justifications restent vides tant que l'IA ne répond pas. "
            "Réessayez après reset quota (~2 h) ou tier Dev : console.groq.com/settings/billing"
        )

    msg_ok = "Plan média prêt — justifications panneaux rédigées par Groq (llama-3.1-8b-instant)."
    msg_partial = (
        f"Plan média prêt — {llm_expl_count}/{llm_target} textes Groq. "
        "Attendez 1 min avant de relancer pour compléter (limite tokens/min Groq)."
    )

    mark_agent_finished()

    return {
        "assistant_message": msg_ok if panel_copy_ok and not partial else msg_partial,
        "extracted_criteria": criteria,
        "rag": out.get("rag"),
        "recommendation": rec,
        "meta": meta,
    }
