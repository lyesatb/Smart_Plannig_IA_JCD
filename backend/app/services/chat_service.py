import re
from app.services.recommendation_service import recommend_panels

CITY_LIST = ["Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes"]

def extract_criteria(message: str):
    lower = message.lower()
    city = None
    for c in CITY_LIST:
        if c.lower() in lower:
            city = c

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

    budget = None
    match = re.search(r"(\d+)\s?k", lower)
    if match:
        budget = int(match.group(1)) * 1000

    objective = "performance"
    if "gare" in lower:
        objective = "proximité gare"
    elif "couverture" in lower or "national" in lower:
        objective = "couverture"
    elif "premium" in lower or "luxe" in lower:
        objective = "premium"

    return {
        "city": city,
        "target": target,
        "industry": industry,
        "budget": budget,
        "duration_days": 14,
        "objective": objective,
        "top_k": 10
    }

def handle_chat(message: str):
    criteria = extract_criteria(message)
    recommendation = recommend_panels(criteria)

    return {
        "assistant_message": (
            "J’ai analysé ta demande et extrait les critères principaux. "
            "Voici une recommandation Smart Planning basée sur la disponibilité, "
            "l’audience, l’adéquation cible, la proximité POI, la visibilité et les contraintes métier."
        ),
        "extracted_criteria": criteria,
        "recommendation": recommendation
    }
