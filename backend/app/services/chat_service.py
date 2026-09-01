import re
from typing import Any

from app.agents.smart_planning_agent import run_agent
from app.config.settings import get_settings, get_openai_env_mismatch_hint
from app.services.recommendation_service import recommend_panels
from app.tools.brief_utils import brief_to_scoring_criteria


CITY_LIST = ["Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes"]


def _fallback_extract_criteria(message: str):
    lower = message.lower()
    city = None
    cities = []
    for c in CITY_LIST:
        if c.lower() in lower:
            cities.append(c)

    if len(cities) == 1:
        city = cities[0]

    target = None
    if "csp" in lower or "premium" in lower or "luxe" in lower:
        target = "CSP+"
    elif "jeune" in lower or "actif" in lower or "étudiant" in lower:
        target = "jeunes actifs"
    elif "famille" in lower:
        target = "familles"

    industry = None
    for item in ["luxe", "food", "retail", "automobile", "beauté", "sport", "banque", "tech", "santé"]:
        if item in lower:
            industry = item
    if industry is None and "bio" in lower:
        industry = "bio"

    budget = None
    match = re.search(r"(\d+)\s?k", lower)
    if match:
        budget = int(match.group(1)) * 1000
    else:
        match_eur = re.search(r"(\d{2,9})\s*€", lower)
        if match_eur:
            budget = int(match_eur.group(1))

    objective = "performance"
    if "gare" in lower:
        objective = "proximité gare"
    elif "couverture" in lower or "national" in lower:
        objective = "couverture"
    elif "premium" in lower or "luxe" in lower:
        objective = "premium"

    poi = None
    if "gare" in lower:
        poi = "gare"

    # Make output size react to brief (helps KPIs vary per prompt)
    top_k = 10
    if isinstance(budget, int) and budget > 0:
        # rough heuristic: more budget -> more panels
        top_k = max(8, min(30, int(round(budget / 25000))))
    if objective == "couverture":
        top_k = max(top_k, 15)
    if cities and len(cities) >= 3:
        top_k = max(top_k, 18)

    raw = {
        "city": city,
        "cities": cities if len(cities) > 1 else None,
        "target": target,
        "industry": industry,
        "budget": budget,
        "duration_days": 14,
        "objective": objective,
        "poi": poi,
        "top_k": top_k,
    }
    return brief_to_scoring_criteria(raw, message)


def _refine_followup(criteria: dict[str, Any], message: str) -> dict[str, Any]:
    """Ajuste explicitement cible / nombre de panneaux depuis le dernier message
    (utile en mode fallback sans LLM ; le chemin LLM gère déjà le contexte)."""
    lower = (message or "").lower()

    # Changement de cible
    if "csp" in lower or "premium" in lower or "luxe" in lower:
        criteria["target"] = "CSP+"
    elif "jeune" in lower or "actif" in lower or "étudiant" in lower or "etudiant" in lower:
        criteria["target"] = "jeunes actifs"
    elif "famille" in lower:
        criteria["target"] = "familles"

    # Nombre de panneaux explicite ("15 panneaux", "top 12")
    m = re.search(r"(\d{1,2})\s*(?:panneaux|faces|écrans|ecrans|supports)", lower)
    if not m:
        m = re.search(r"top\s*(\d{1,2})", lower)
    if m:
        criteria["top_k"] = max(6, min(15, int(m.group(1))))
    elif re.search(r"\bplus\b.*(panneaux|faces|supports)|(panneaux|faces|supports).*\bplus\b", lower):
        criteria["top_k"] = min(15, int(criteria.get("top_k") or 10) + 4)
    elif re.search(r"\bmoins\b.*(panneaux|faces|supports)|(panneaux|faces|supports).*\bmoins\b", lower):
        criteria["top_k"] = max(6, int(criteria.get("top_k") or 10) - 4)

    return criteria


def _merge_followup_criteria(
    message: str, prior_criteria: dict[str, Any] | None
) -> dict[str, Any]:
    """Suivi de conversation sans LLM : on repart des critères précédents et on
    applique les nouveautés détectées dans le dernier message (ville, budget, POI…)."""
    if prior_criteria:
        merged = brief_to_scoring_criteria(dict(prior_criteria), message)
        return _refine_followup(merged, message)
    return _fallback_extract_criteria(message)


def _fmt_budget(value: Any) -> str | None:
    try:
        return f"{int(value):,} €".replace(",", " ")
    except (TypeError, ValueError):
        return None


def _criteria_summary(c: dict[str, Any]) -> str:
    bits: list[str] = []
    if c.get("cities"):
        bits.append("villes " + ", ".join(str(x) for x in c["cities"]))
    elif c.get("city"):
        bits.append(str(c["city"]))
    if c.get("target"):
        bits.append("cible " + str(c["target"]))
    if c.get("industry"):
        bits.append("secteur " + str(c["industry"]))
    if c.get("poi"):
        bits.append("POI " + str(c["poi"]))
    if c.get("objective"):
        bits.append("objectif " + str(c["objective"]))
    budget = _fmt_budget(c.get("budget"))
    if budget:
        bits.append("budget " + budget)
    return ", ".join(bits) if bits else "critères par défaut"


def _criteria_diff(
    prior: dict[str, Any] | None, current: dict[str, Any]
) -> list[str]:
    if not prior:
        return []
    labels = [
        ("city", "ville"),
        ("cities", "villes"),
        ("target", "cible"),
        ("industry", "secteur"),
        ("poi", "POI"),
        ("objective", "objectif"),
        ("budget", "budget"),
        ("top_k", "nombre de panneaux"),
    ]
    changes: list[str] = []
    for key, label in labels:
        pv, cv = prior.get(key), current.get(key)
        if pv == cv or cv in (None, "", []):
            continue
        if key == "budget":
            cv = _fmt_budget(cv) or cv
        elif isinstance(cv, list):
            cv = ", ".join(str(x) for x in cv)
        changes.append(f"{label} → {cv}")
    return changes


def build_assistant_reply(
    criteria: dict[str, Any],
    recommendation: dict[str, Any],
    prior_criteria: dict[str, Any] | None = None,
    extra_note: str | None = None,
) -> str:
    """Réponse conversationnelle pour le fil de discussion."""
    results = recommendation.get("results") or []
    n = len(results)
    if n == 0:
        return (
            "Je n'ai trouvé aucun panneau pour ces critères. "
            "Essaie d'élargir la ville, le POI ou le budget, et redis-moi ce que tu cherches."
        )

    avg = recommendation.get("average_score")
    reach = recommendation.get("estimated_daily_reach")
    reach_txt = f"{int(reach):,}".replace(",", " ") if isinstance(reach, (int, float)) else "—"

    intro = "J'ai ajusté le plan" if prior_criteria else "Voici un premier plan média"
    parts = [f"{intro} ({_criteria_summary(criteria)})."]

    diff = _criteria_diff(prior_criteria, criteria)
    if diff:
        parts.append("Changements pris en compte : " + " ; ".join(diff) + ".")

    parts.append(
        f"{n} panneaux retenus, score moyen {avg}, reach estimé {reach_txt}/jour."
    )
    if extra_note:
        parts.append(extra_note)
    parts.append(
        "Dis-moi si tu veux ajuster : ville, budget, POI/objectif, cible ou "
        "le nombre de panneaux — j'affine le plan."
    )
    return " ".join(parts)


def handle_chat(
    message: str,
    history: list[dict[str, Any]] | None = None,
    prior_criteria: dict[str, Any] | None = None,
):
    settings = get_settings()
    if settings.llm_enabled():
        try:
            return run_agent(message, history=history, prior_criteria=prior_criteria)
        except Exception as exc:
            # Groq/OpenAI unreachable (réseau, SSL entreprise, clé invalide) → fallback explicite
            err = type(exc).__name__
            hint = (
                "Clé Groq détectée mais appel LLM échoué "
                f"({err}). Ajoutez GROQ_INSECURE_SKIP_SSL_VERIFY=1 dans votre .env "
                "(déjà activé dans docker-compose), redémarrez, ou lancez le backend hors Docker."
            )
            criteria = _merge_followup_criteria(message, prior_criteria)
            recommendation = recommend_panels(criteria)
            return {
                "assistant_message": build_assistant_reply(
                    criteria, recommendation, prior_criteria=prior_criteria, extra_note=hint
                ),
                "extracted_criteria": criteria,
                "recommendation": recommendation,
                "meta": {
                    "llm_used": False,
                    "llm_provider": "groq" if settings.groq_api_key else None,
                    "brief_source": "heuristic_fallback",
                    "recommendation_source": "scoring_engine",
                    "explanation_source": "template_rules",
                    "panel_copy_llm": False,
                    "llm_ssl_verify": not settings.llm_skip_ssl_verify,
                    "llm_tls_mode": "verified" if not settings.llm_skip_ssl_verify else "docker_network",
                    "error": err,
                },
            }

    criteria = _merge_followup_criteria(message, prior_criteria)
    recommendation = recommend_panels(criteria)
    mismatch = get_openai_env_mismatch_hint()
    note = (
        mismatch
        if mismatch
        else "Mode sans clé LLM : plan basé sur le scoring métier (les textes sont générés par règles)."
    )
    return {
        "assistant_message": build_assistant_reply(
            criteria, recommendation, prior_criteria=prior_criteria, extra_note=note
        ),
        "extracted_criteria": criteria,
        "recommendation": recommendation,
        "meta": {
            "llm_used": False,
            "llm_provider": None,
            "brief_source": "heuristic_fallback",
            "recommendation_source": "scoring_engine",
            "explanation_source": "template_rules",
            "panel_copy_llm": False,
            "llm_ssl_verify": not get_settings().llm_skip_ssl_verify,
            "llm_tls_mode": (
                "verified"
                if not get_settings().llm_skip_ssl_verify
                else "docker_network"
            ),
        },
    }
