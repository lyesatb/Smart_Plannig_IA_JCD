from pathlib import Path

import pandas as pd

from app.services.analytics import build_recommendation_analytics

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "panels.csv"
PANELS = pd.read_csv(DATA_PATH)

def normalize(series):
    min_v = series.min()
    max_v = series.max()
    if max_v == min_v:
        return series * 0
    return (series - min_v) / (max_v - min_v) * 100

def target_score(row, target):
    if not target:
        return (row["audience_csp_plus"] + row["audience_young_active"]) / 2

    target = target.lower()
    if "csp" in target or "premium" in target or "luxe" in target:
        return row["audience_csp_plus"]
    if "jeune" in target or "actif" in target or "étudiant" in target:
        return row["audience_young_active"]
    if "famille" in target:
        return (row["audience_csp_plus"] * 0.45) + (row["audience_young_active"] * 0.55)
    return (row["audience_csp_plus"] + row["audience_young_active"]) / 2

def poi_score(row, objective, industry):
    score = 50
    poi = str(row["poi_nearby"]).lower()
    district = str(row["district"]).lower()

    if industry:
        ind = industry.lower()
        if ind in ["luxe", "beauté"] and ("affaires" in district or "premium" in district):
            score += 30
        if ind in ["food", "retail"] and ("centre commercial" in poi or "zone commerciale" in district):
            score += 25
        if ind in ["sport"] and ("stade" in poi or "université" in poi):
            score += 20

    if objective:
        obj = objective.lower()
        if "gare" in obj and "gare" in poi:
            score += 35
        if "couverture" in obj:
            score += 10
        if "premium" in obj and ("premium" in district or "affaires" in district):
            score += 25

    return min(score, 100)

def constraint_score(row):
    if row["maintenance_status"] != "ok":
        return 0
    return 100

def explain(row, criteria: dict):
    reasons = []
    target = (criteria.get("target") or "").lower()
    objective = (criteria.get("objective") or "").lower()
    industry = (criteria.get("industry") or "").lower()

    if row["availability"]:
        reasons.append("disponible sur la période demandée")
    if row["daily_traffic"] > 50000:
        reasons.append("trafic quotidien élevé")

    # Audience reasons depend on requested target; avoid claiming segments not asked
    if "csp" in target or "premium" in target or "luxe" in target:
        if row["audience_csp_plus"] > 65:
            reasons.append("forte affinité CSP+ / premium")
    elif "jeune" in target or "actif" in target or "étudiant" in target:
        if row["audience_young_active"] > 65:
            reasons.append("bonne affinité jeunes actifs")
    elif "famille" in target:
        if (row["audience_csp_plus"] * 0.45 + row["audience_young_active"] * 0.55) > 65:
            reasons.append("bonne affinité familles")
    else:
        # No explicit target: keep it neutral
        if row["audience_csp_plus"] > 75:
            reasons.append("audience premium élevée")

    if row["visibility_score"] > 80:
        reasons.append("excellente visibilité")
    poi_val = str(row.get("poi_nearby") or "").strip()
    if poi_val:
        if "gare" in objective and poi_val.lower() == "gare":
            reasons.append("emplacement proche d'une gare")
        elif "gare" not in objective or poi_val.lower() != "gare":
            reasons.append(f"POI pertinent : {poi_val}")
        else:
            reasons.append(f"proximité POI : {poi_val}")

    # Industry hints (lightweight, non-invasive)
    if industry in {"bio", "food", "retail"} and str(row.get("poi_nearby", "")).lower() in {"centre commercial", "zone commerciale"}:
        reasons.append("cohérent retail / proximité shopping")

    if not reasons:
        reasons.append("profil équilibré et compatible avec la demande")

    city = row.get("city") or ""
    district = row.get("district") or ""
    fmt = row.get("format") or "DOOH"
    loc = f"À {city} ({district}), " if city else ""
    return f"{loc}le format {fmt} est retenu car il est " + ", ".join(reasons[:4]) + "."


def explain_detailed(row, criteria: dict) -> str:
    """Justification enrichie (export Excel / pool) — 2 phrases, sans liste de KPI bruts."""
    city = row.get("city") or ""
    district = row.get("district") or ""
    fmt = row.get("format") or "DOOH"
    poi = str(row.get("poi_nearby") or "zone urbaine")
    target = (criteria.get("target") or "la cible visée").lower()
    objective = (criteria.get("objective") or "la performance média").lower()
    industry = (criteria.get("industry") or "").lower()

    loc = f"À {city} ({district}), " if city else ""
    p1 = (
        f"{loc}le {fmt} en proximité « {poi} » répond au brief "
        f"({objective}) avec un profil adapté à {target}."
    )

    extras = []
    if industry:
        extras.append(f"secteur {industry}")
    if "gare" in objective and poi.lower() == "gare":
        extras.append("flux voyageurs et correspondances")
    elif poi.lower() == "aéroport":
        extras.append("cible voyageurs premium")
    elif poi.lower() in {"centre commercial", "zone commerciale"}:
        extras.append("parcours achat et retail")
    if row.get("availability"):
        extras.append("disponibilité confirmée sur la période")
    if extras:
        p2 = "Atouts clés : " + ", ".join(extras[:3]) + "."
    else:
        p2 = "Emplacement retenu pour diversifier le plan tout en maximisant la pertinence contextuelle."

    return f"{p1} {p2}"


def _compute_scored_frames(criteria: dict):
    """Éligibles, pool top scores, sélection diversifiée, non-éligibles (maintenance)."""
    df = PANELS.copy()

    city = criteria.get("city")
    cities = criteria.get("cities")
    if isinstance(cities, list) and len(cities) > 0:
        city_l = {str(c).lower() for c in cities if c}
        df = df[df["city"].str.lower().isin(city_l)]
    elif city:
        df = df[df["city"].str.lower() == str(city).lower()]

    if df.empty:
        empty = df.copy()
        return empty, empty, empty, criteria, empty

    ineligible = df[df["maintenance_status"] != "ok"].copy()
    df = df[df["maintenance_status"] == "ok"].copy()

    df["availability_score"] = df["availability"].apply(lambda x: 100 if bool(x) else 0)
    df["audience_score"] = normalize(df["daily_traffic"])
    df["target_match_score"] = df.apply(lambda r: target_score(r, criteria.get("target")), axis=1)
    df["poi_score"] = df.apply(
        lambda r: poi_score(r, criteria.get("objective"), criteria.get("industry")),
        axis=1,
    )
    df["visibility_component"] = df["visibility_score"]
    df["constraint_score"] = df.apply(constraint_score, axis=1)

    df["smart_score"] = (
        0.30 * df["availability_score"]
        + 0.20 * df["audience_score"]
        + 0.20 * df["target_match_score"]
        + 0.15 * df["poi_score"]
        + 0.10 * df["visibility_component"]
        + 0.05 * df["constraint_score"]
    ).round(2)

    top_k = int(criteria.get("top_k") or 12)
    top_k = max(6, min(top_k, 15))
    criteria = {**criteria, "top_k": top_k}

    eligible = df.copy()
    pool = df.sort_values("smart_score", ascending=False).head(max(top_k * 8, 60))
    selected = _diversified_pick(pool, top_k, criteria)
    return eligible, pool, selected, criteria, ineligible

def _max_per_city(criteria: dict | None, k: int) -> int:
    if not criteria:
        return max(2, k)
    cities = criteria.get("cities")
    objective = (criteria.get("objective") or "").lower()
    if isinstance(cities, list) and len(cities) >= 2:
        return max(2, k // max(len(cities), 2))
    if "couverture" in objective or "national" in objective:
        return max(2, k // 4)
    return max(3, k)


def _diversified_pick(df: pd.DataFrame, k: int, criteria: dict | None = None) -> pd.DataFrame:
    """
    Pick top-k while encouraging variety across district / poi / format / city.
    Deterministic: no randomness.
    """
    if df.empty:
        return df

    k = max(int(k), 1)
    candidates = df.sort_values("smart_score", ascending=False).copy()
    max_city = _max_per_city(criteria, k)

    picked_rows = []
    used_district: set[str] = set()
    used_poi: set[str] = set()
    used_format: set[str] = set()
    city_counts: dict[str, int] = {}

    def norm(v) -> str:
        return str(v).strip().lower()

    remaining = candidates
    strict_rounds = 3
    for _ in range(strict_rounds):
        if len(picked_rows) >= k or remaining.empty:
            break

        round_pick = []
        for _, row in remaining.iterrows():
            d = norm(row.get("district"))
            p = norm(row.get("poi_nearby"))
            f = norm(row.get("format"))
            c = norm(row.get("city"))
            if city_counts.get(c, 0) >= max_city:
                continue

            if d in used_district or p in used_poi or f in used_format:
                continue

            round_pick.append(row)
            used_district.add(d)
            used_poi.add(p)
            used_format.add(f)
            city_counts[c] = city_counts.get(c, 0) + 1
            if len(picked_rows) + len(round_pick) >= k:
                break

        if not round_pick:
            break

        picked_rows.extend(round_pick)
        picked_ids = {r.get("panel_id") for r in picked_rows}
        remaining = remaining[~remaining["panel_id"].isin(picked_ids)]

    # fill remaining slots with best scores, but still prefer unseen district/poi when possible
    if len(picked_rows) < k and not remaining.empty:
        def penalty(row):
            d = norm(row.get("district"))
            p = norm(row.get("poi_nearby"))
            f = norm(row.get("format"))
            c = norm(row.get("city"))
            pen = 0.0
            if d in used_district:
                pen += 8.0
            if p in used_poi:
                pen += 6.0
            if f in used_format:
                pen += 4.0
            if city_counts.get(c, 0) >= max_city:
                pen += 12.0
            return pen

        remaining = remaining.copy()
        remaining["div_penalty"] = remaining.apply(penalty, axis=1)
        remaining["div_score"] = remaining["smart_score"] - remaining["div_penalty"]
        remaining = remaining.sort_values(["div_score", "smart_score"], ascending=False)

        need = k - len(picked_rows)
        picked_rows.extend([row for _, row in remaining.head(need).iterrows()])

    picked = pd.DataFrame(picked_rows)
    # preserve consistent ordering
    return picked.sort_values("smart_score", ascending=False).head(k)

def recommend_panels(criteria):
    eligible, pool, df, criteria, ineligible = _compute_scored_frames(criteria)

    if eligible.empty:
        return {
            "summary": "Aucun panneau trouvé pour ces critères.",
            "results": [],
            "criteria": criteria,
        }

    df["explanation"] = ""

    analytics = build_recommendation_analytics(eligible, pool, df, criteria, ineligible)

    results = df[[
        "panel_id", "city", "latitude", "longitude", "district", "format",
        "screen_type", "visibility_score", "daily_traffic", "audience_csp_plus",
        "audience_young_active", "availability", "mall_name", "poi_nearby",
        "price_per_day", "smart_score", "explanation",
    ]].to_dict(orient="records")

    avg_score = round(sum([r["smart_score"] for r in results]) / len(results), 2) if results else 0
    reach = int(sum([r["daily_traffic"] for r in results]))

    return {
        "summary": f"{len(results)} panneaux recommandés avec un score moyen de {avg_score}. Audience potentielle quotidienne estimée : {reach:,}.",
        "criteria": criteria,
        "estimated_daily_reach": reach,
        "average_score": avg_score,
        "results": results,
        "analytics": analytics,
    }

def get_kpis():
    return {
        "total_panels": int(len(PANELS)),
        "available_panels": int(PANELS["availability"].sum()),
        "cities": int(PANELS["city"].nunique()),
        "average_visibility": round(float(PANELS["visibility_score"].mean()), 2),
        "total_daily_traffic": int(PANELS["daily_traffic"].sum())
    }

def get_panels_preview(city=None, limit=200):
    df = PANELS.copy()
    if city:
        df = df[df["city"].str.lower() == city.lower()]
    return df.head(limit).to_dict(orient="records")
