from __future__ import annotations

import re
from typing import Any

from app.config.settings import get_settings

CITY_NAMES = [
    "Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes",
]


def _cities_from_message(message: str) -> list[str]:
    lower = (message or "").lower()
    found: list[str] = []
    for name in CITY_NAMES:
        if re.search(rf"\b{re.escape(name.lower())}\b", lower):
            found.append(name)
    return found


def compute_top_k(brief: dict[str, Any], message: str = "") -> int:
    """Nombre de panneaux selon budget / objectif / couverture (évite top_k=20 fixe)."""
    budget = brief.get("budget")
    objective = (brief.get("objective") or "").lower()
    cities = brief.get("cities") or []
    lower = (message or "").lower()

    top_k = 12
    if any(w in lower for w in ("optimise", "optimiser", "automatique", "retail", "national")):
        top_k = max(top_k, 12)
    if isinstance(budget, (int, float)) and budget > 0:
        top_k = max(8, min(15, int(round(float(budget) / 25000))))
    if "couverture" in objective or "national" in lower:
        top_k = max(top_k, 14)
    if isinstance(cities, list) and len(cities) >= 3:
        top_k = max(top_k, min(15, 4 * len(cities)))
    if brief.get("city") and not cities:
        top_k = max(top_k, 10)

    top_k = int(brief.get("top_k") or top_k)
    return max(6, min(top_k, 15))


def brief_to_scoring_criteria(brief: dict[str, Any], message: str = "") -> dict[str, Any]:
    """Enrichit le brief LLM pour le moteur de scoring (top_k, villes, objectif)."""
    c = dict(brief)
    c["top_k"] = compute_top_k(brief, message)

    if not c.get("objective"):
        lower = (message or "").lower()
        if "gare" in lower:
            c["objective"] = "proximité gare"
            c.setdefault("poi", "gare")
        elif "couverture" in lower or "national" in lower:
            c["objective"] = "couverture"
        elif "premium" in lower or "luxe" in lower:
            c["objective"] = "premium"

    if not c.get("industry") and "bio" in (message or "").lower():
        c["industry"] = "bio"

    found = _cities_from_message(message)
    if len(found) >= 2:
        c["cities"] = found
        c["city"] = None
    elif len(found) == 1:
        c["city"] = found[0]
        if not c.get("cities"):
            c["cities"] = None

    if not c.get("budget"):
        lower = (message or "").lower()
        m = re.search(r"(\d+)\s*k\s*€?", lower) or re.search(r"(\d{2,9})\s*€", lower)
        if m:
            val = int(m.group(1))
            c["budget"] = val * 1000 if "k" in m.group(0).lower() else val

    return c
