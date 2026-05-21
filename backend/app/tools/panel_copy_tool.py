from __future__ import annotations

import json
import re
import time
from typing import Any

from app.config.settings import get_settings
from app.llm.factory import get_chat_llm, parse_llm_json_any
from app.llm.invoke import invoke_with_retry
from app.llm.throttle import wait_llm_slot
CITY_ALIASES: dict[str, list[str]] = {
    "paris": ["paris", "parisien", "parisienne", "capitale"],
    "lyon": ["lyon", "lyonnais", "lyonnaise"],
    "bordeaux": ["bordeaux", "bordelais", "bordelaise"],
    "marseille": ["marseille", "marseillais"],
    "lille": ["lille", "lillois"],
    "toulouse": ["toulouse", "toulousain"],
    "nantes": ["nantes", "nantais"],
}


def _compact_brief(brief: dict[str, Any]) -> str:
    keys = ("city", "cities", "target", "budget", "objective", "poi", "industry", "top_k")
    mini = {k: brief[k] for k in keys if brief.get(k) is not None}
    return json.dumps(mini, ensure_ascii=False)


def _qualitative_label(value: float, high: float, mid: float, labels: tuple[str, str, str]) -> str:
    if value >= high:
        return labels[0]
    if value >= mid:
        return labels[1]
    return labels[2]


def _planner_hints(panel: dict[str, Any], brief: dict[str, Any]) -> list[str]:
    hints: list[str] = []
    target = (brief.get("target") or "").lower()
    objective = (brief.get("objective") or "").lower()
    industry = (brief.get("industry") or "").lower()
    poi = str(panel.get("poi_nearby") or "").lower()
    district = str(panel.get("district") or "").lower()
    csp = float(panel.get("audience_csp_plus") or 0)
    young = float(panel.get("audience_young_active") or 0)

    if "csp" in target or "premium" in objective or "luxe" in objective:
        if csp >= 75:
            hints.append("audience premium alignée au brief")
    if "jeune" in target or "actif" in target:
        if young >= 70:
            hints.append("forte présence jeunes actifs")
    if industry == "retail" and poi in {"centre commercial", "zone commerciale"}:
        hints.append("parcours achat retail")
    if "gare" in objective and poi == "gare":
        hints.append("flux voyageurs et correspondances")
    elif poi == "aéroport":
        hints.append("cible voyageurs premium")
    if "université" in poi or "campus" in district.lower():
        hints.append("zone étudiante / campus")
    return hints[:3]


def _panel_for_planner(p: dict[str, Any], brief: dict[str, Any]) -> dict[str, Any]:
    traffic = float(p.get("daily_traffic") or 0)
    vis = float(p.get("visibility_score") or 0)
    csp = float(p.get("audience_csp_plus") or 0)
    return {
        "panel_id": p.get("panel_id"),
        "city": p.get("city"),
        "district": p.get("district"),
        "format": p.get("format"),
        "poi_nearby": p.get("poi_nearby"),
        "traffic_level": _qualitative_label(
            traffic, 75000, 50000, ("trafic très élevé", "bon trafic", "trafic modéré")
        ),
        "visibility_level": _qualitative_label(
            vis, 85, 70, ("excellente visibilité", "bonne visibilité", "visibilité correcte")
        ),
        "audience_profile": _qualitative_label(
            csp, 80, 65, ("audience premium dominante", "bonne part CSP+", "audience mixte")
        ),
        "strategic_angles": _planner_hints(p, brief),
    }


def _is_kpi_dump(expl: str, panel: dict[str, Any]) -> bool:
    el = expl.lower()
    if re.search(r"\bscore\s+smart\b", el) or "smart_score" in el:
        return True
    if re.search(r"\d{2,}\s*%", el) and ("visibilité" in el or "csp" in el):
        return True
    traffic = panel.get("daily_traffic")
    if traffic and str(int(traffic)) in expl.replace(" ", ""):
        return True
    return False


def _mentions_wrong_city(expl: str, city: str) -> bool:
    if not city:
        return False
    el = expl.lower()
    city_l = city.lower()
    for other, aliases in CITY_ALIASES.items():
        if other == city_l:
            continue
        for alias in aliases:
            if alias in el and city_l not in el:
                return True
    return False


def _mentions_panel_city(expl: str, city: str) -> bool:
    if not city:
        return True
    el = expl.lower()
    city_l = city.lower()
    if city_l in el:
        return True
    for alias in CITY_ALIASES.get(city_l, []):
        if alias in el:
            return True
    return False


def _mentions_gare_incorrectly(expl: str, poi: str) -> bool:
    el = expl.lower()
    if "gare" in el and poi.lower() != "gare":
        return True
    return False


def _explanation_is_valid(expl: str, panel: dict[str, Any]) -> bool:
    el = expl.lower()
    if not expl or len(expl.strip()) < 25:
        return False
    if _is_kpi_dump(expl, panel):
        return False
    city = str(panel.get("city") or "")
    poi = str(panel.get("poi_nearby") or "")
    if _mentions_wrong_city(expl, city):
        return False
    if _mentions_gare_incorrectly(expl, poi):
        return False
    # Contexte local : ville, quartier ou POI (tolérant pour llama-3.1-8b-instant)
    district = str(panel.get("district") or "").lower()
    poi_l = poi.lower()
    has_local = (
        _mentions_panel_city(expl, city)
        or (district and district in el)
        or (poi_l and poi_l in el)
        or "paris" in el
        and city.lower() == "paris"
    )
    return has_local


def _parse_batch_explanations(content: str, expected_n: int | None = None) -> list[dict[str, Any]]:
    if not content or not content.strip():
        return []
    text = content.strip()
    data: Any = None
    match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", text)
    if match:
        try:
            data = json.loads(match.group(0))
        except Exception:
            data = None
    if data is None:
        try:
            data = parse_llm_json_any(text)
        except Exception:
            return []

    if isinstance(data, dict):
        for key in ("items", "results", "explanations", "panels", "data"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            return []

    if not isinstance(data, list):
        return []
    items = [x for x in data if isinstance(x, dict) and x.get("explanation")]
    if expected_n is not None and len(items) != expected_n:
        return []
    return items


def _match_panel_id(item: dict[str, Any], panels: list[dict[str, Any]]) -> str | None:
    pid = str(item.get("panel_id") or item.get("id") or "")
    if pid:
        for p in panels:
            full = str(p.get("panel_id") or "")
            if pid == full or full.endswith(pid) or pid.endswith(full[-8:]):
                return full
    idx = item.get("index")
    if isinstance(idx, int) and 0 <= idx < len(panels):
        return str(panels[idx].get("panel_id") or "")
    return None


def _rag_context(rag_matches: list[dict[str, Any]]) -> str:
    if not rag_matches:
        return ""
    parts: list[str] = []
    for m in rag_matches[:3]:
        content = (m.get("content") or "").strip()
        if content:
            parts.append(content[:180])
    if not parts:
        return ""
    return "\n\nContexte métier DOOH (RAG) :\n" + "\n---\n".join(parts) + "\n"


def _build_prompt(
    user_message: str,
    brief: dict[str, Any],
    panels: list[dict[str, Any]],
    *,
    rag_matches: list[dict[str, Any]] | None = None,
) -> str:
    """Prompt compact (limite tokens Groq ~6K/min)."""
    contexts = [_panel_for_planner(p, brief) for p in panels]
    n = len(panels)
    rag_block = _rag_context(rag_matches or [])
    return (
        f"Planner DOOH JCDecaux — {n} justifications pour le plan média.\n"
        f"Par panneau : 2 phrases, 60-90 mots, ton conseil, angles DIFFÉRENTS (mix, parcours, POI, secteur).\n"
        f"Pas de KPI chiffrés. Ville/quartier/POI réels. Formulations toutes distinctes.\n"
        f"{rag_block}\n"
        f"Client: {user_message[:280]}\n"
        f"Brief: {_compact_brief(brief)}\n"
        f"Panneaux: {json.dumps(contexts, ensure_ascii=False)}\n"
        f"Réponse = UNIQUEMENT un JSON array de exactement {n} objets, sans markdown :\n"
        f'[{{"panel_id":"<copier id panneau>","explanation":"2 phrases riches"}}]'
    )


def _explain_batch(
    llm,
    user_message: str,
    brief: dict[str, Any],
    panels: list[dict[str, Any]],
    rag_matches: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    n = len(panels)
    prompt = _build_prompt(user_message, brief, panels, rag_matches=rag_matches)
    content = ""
    for attempt in range(2):
        resp = invoke_with_retry(
            llm,
            prompt if attempt == 0 else prompt + "\nRappel: JSON array uniquement, commence par [",
            min_interval_s=2.0,
            max_retries=2,
            base_delay_s=6.0,
            fail_fast_rate_limit=False,
        )
        content = getattr(resp, "content", None) or str(resp)
        items = _parse_batch_explanations(content, expected_n=n)
        if len(items) == n:
            break
        time.sleep(1.5)
    out: dict[str, str] = {}
    items = _parse_batch_explanations(content, expected_n=n)
    if len(items) == len(panels):
        for i, item in enumerate(items):
            pid = str(panels[i].get("panel_id") or "")
            expl = item.get("explanation")
            if pid and isinstance(expl, str) and expl.strip():
                out[pid] = expl.strip()
        return out
    for i, item in enumerate(items):
        pid = _match_panel_id(item, panels) or (
            str(panels[i].get("panel_id") or "") if i < len(panels) else None
        )
        expl = item.get("explanation")
        if pid and isinstance(expl, str) and expl.strip():
            out[pid] = expl.strip()
    return out


def _apply_llm_mapping(
    mapping: dict[str, str],
    panels: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
) -> tuple[int, list[dict[str, Any]]]:
    ok = 0
    missing: list[dict[str, Any]] = []
    for p in panels:
        pid = str(p.get("panel_id") or "")
        expl = mapping.get(pid)
        if expl and _explanation_is_valid(expl, p):
            by_id[pid]["explanation"] = expl
            ok += 1
        else:
            missing.append(p)
    return ok, missing


def enrich_recommendation_explanations(
    user_message: str,
    brief: dict[str, Any],
    rag_matches: list[dict[str, Any]],
    recommendation: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """
    Justifications 100 % Groq — lots de 3 panneaux max (≈3-4 appels, respecte TPM Groq).
    """
    settings = get_settings()
    if not settings.llm_enabled():
        return recommendation, False

    results = list(recommendation.get("results") or [])
    if not results:
        return recommendation, False

    targets = results[: min(len(results), settings.groq_max_panels_llm)]
    llm = get_chat_llm(settings, planner_copy=True)
    by_id = {str(r["panel_id"]): r for r in results}
    for p in targets:
        by_id[str(p["panel_id"])]["explanation"] = ""

    llm_ok = 0
    rag = rag_matches or []
    batch_n = 3
    gap = max(3.0, settings.groq_batch_delay_s)
    rate_limited = False

    for i in range(0, len(targets), batch_n):
        if rate_limited:
            break
        chunk = targets[i : i + batch_n]
        wait_llm_slot(max(2.5, settings.groq_min_interval_s))
        try:
            mapping = _explain_batch(llm, user_message, brief, chunk, rag_matches=rag)
            added, _ = _apply_llm_mapping(mapping, chunk, by_id)
            llm_ok += added
        except Exception as e:
            err = str(e).lower()
            if "tokens per day" in err or "429" in err or "rate" in err:
                rate_limited = True
        if i + batch_n < len(targets) and not rate_limited:
            time.sleep(gap)

    recommendation["results"] = [by_id[str(r["panel_id"])] for r in results]
    target_n = len(targets)
    ok = llm_ok >= target_n
    recommendation["llm_explanations_count"] = llm_ok
    recommendation["llm_explanations_target"] = target_n
    recommendation["llm_only_mode"] = True
    return recommendation, ok
