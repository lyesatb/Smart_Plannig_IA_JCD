from __future__ import annotations

import re
from typing import Any

from app.config.settings import get_settings
from app.services.geo import (
    normalize_enseigne,
    parse_arrondissement,
    parse_distance_m,
    parse_enseigne,
)

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


_NB = r"(?:panneaux?|faces?|supports?|écrans?|ecrans?)?"
_PER_CITY_RE = re.compile(
    rf"(\d{{1,2}})\s*{_NB}\s*(?:pour|par)\s*(?:chaque(?:\s+ville)?|chacune?|ville)",
    re.I,
)


def parse_panel_counts(
    message: str,
) -> tuple[int | None, dict[str, int] | None]:
    """Détecte un nombre de panneaux par ville dans le message.

    - « 5 pour chaque », « 5 par ville » → per_city=5
    - « 8 pour Lyon et 2 pour Paris » → city_quotas={"Lyon":8,"Paris":2}
    Si « pour chaque / par ville » est présent, per_city PRIME (on ignore les quotas
    par ville, souvent des rappels de l'ancien plan comme « tu as mis 8 pour Lyon »).
    """
    text = message or ""
    m = _PER_CITY_RE.search(text)
    if m:
        return max(1, min(15, int(m.group(1)))), None

    quotas: dict[str, int] = {}
    for name in CITY_NAMES:
        nl = re.escape(name)
        pm = re.search(
            rf"(\d{{1,2}})\s*{_NB}\s*(?:pour|à|a|dans|sur|:|=)\s*{nl}\b", text, re.I
        ) or re.search(rf"\b{nl}\s*(?::|=|->|→)?\s*(\d{{1,2}})\b", text, re.I)
        if pm:
            quotas[name] = max(1, min(15, int(pm.group(1))))
    return None, (quotas or None)


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

    # Proximité d'une enseigne / arrondissement / rayon (« magasins Maison Nicolas dans le 15ème »)
    # Le dernier message prime ; sinon on garde les valeurs héritées (LLM ou tour précédent).
    ens_msg = parse_enseigne(message)
    if ens_msg:
        c["enseigne"] = ens_msg
    elif c.get("enseigne"):
        c["enseigne"] = normalize_enseigne(c.get("enseigne")) or c.get("enseigne")

    arr_msg = parse_arrondissement(message)
    if arr_msg:
        c["arrondissement"] = arr_msg
        # Un arrondissement implique Paris si aucune ville n'est citée
        if not c.get("city") and not c.get("cities"):
            c["city"] = "Paris"
    elif c.get("arrondissement") is not None:
        try:
            c["arrondissement"] = int(c["arrondissement"])
        except (TypeError, ValueError):
            c["arrondissement"] = None

    dist_msg = parse_distance_m(message)
    if dist_msg:
        c["max_distance_m"] = dist_msg

    # Durée de campagne (base hebdomadaire) : « 3 semaines » / « 21 jours »
    low = (message or "").lower()
    mw = re.search(r"(\d{1,2})\s*semaines?", low)
    md = re.search(r"(\d{1,3})\s*jours?", low)
    if mw:
        c["duration_days"] = max(7, int(mw.group(1)) * 7)
    elif md:
        c["duration_days"] = max(1, int(md.group(1)))

    # Nombre de panneaux par ville (« 5 pour chaque », « 8 pour Lyon et 2 pour Paris »)
    # Le dernier message prime toujours sur les valeurs héritées du tour précédent.
    per_city, quotas = parse_panel_counts(message)
    if per_city:
        c["per_city"] = per_city
        c["city_quotas"] = None
    elif quotas:
        c["city_quotas"] = quotas
        c["per_city"] = None
        keys = list(quotas.keys())
        if len(keys) >= 2:
            c["cities"] = keys
            c["city"] = None
        elif len(keys) == 1 and not c.get("cities"):
            c["city"] = keys[0]

    return c
