import re

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

def handle_chat(message: str):
    settings = get_settings()
    if settings.llm_enabled():
        try:
            return run_agent(message)
        except Exception as exc:
            # Groq/OpenAI unreachable (réseau, SSL entreprise, clé invalide) → fallback explicite
            err = type(exc).__name__
            hint = (
                "Clé Groq détectée mais appel LLM échoué "
                f"({err}). Ajoutez GROQ_INSECURE_SKIP_SSL_VERIFY=1 dans votre .env "
                "(déjà activé dans docker-compose), redémarrez, ou lancez le backend hors Docker.\n\n"
            )
            criteria = _fallback_extract_criteria(message)
            recommendation = recommend_panels(criteria)
            return {
                "assistant_message": f"{hint}Recommandation via scoring métier (fallback).",
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

    criteria = _fallback_extract_criteria(message)
    recommendation = recommend_panels(criteria)
    mismatch = get_openai_env_mismatch_hint()
    prefix = (
        f"{mismatch}\n\n"
        if mismatch
        else "Aucune clé LLM (GROQ_API_KEY ou OPENAI_API_KEY sk-/proj-): fallback heuristique.\n\n"
    )
    return {
        "assistant_message": (
            f"{prefix}"
            "Voici une recommandation basée sur le scoring métier."
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
