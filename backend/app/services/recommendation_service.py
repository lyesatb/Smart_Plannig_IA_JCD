from pathlib import Path
import pandas as pd

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

def explain(row):
    reasons = []
    if row["availability"]:
        reasons.append("disponible sur la période demandée")
    if row["daily_traffic"] > 50000:
        reasons.append("trafic quotidien élevé")
    if row["audience_csp_plus"] > 70:
        reasons.append("forte affinité CSP+ / premium")
    if row["audience_young_active"] > 70:
        reasons.append("bonne affinité jeunes actifs")
    if row["visibility_score"] > 80:
        reasons.append("excellente visibilité")
    if row["poi_nearby"] in ["gare", "centre commercial", "aéroport"]:
        reasons.append(f"proximité stratégique avec un POI : {row['poi_nearby']}")
    if not reasons:
        reasons.append("profil équilibré et compatible avec la demande")
    return "Ce panneau est recommandé car il est " + ", ".join(reasons[:4]) + "."

def recommend_panels(criteria):
    df = PANELS.copy()

    city = criteria.get("city")
    if city:
        df = df[df["city"].str.lower() == city.lower()]

    if df.empty:
        return {
            "summary": "Aucun panneau trouvé pour ces critères.",
            "results": [],
            "criteria": criteria
        }

    df = df[df["maintenance_status"] == "ok"].copy()

    df["availability_score"] = df["availability"].apply(lambda x: 100 if bool(x) else 0)
    df["audience_score"] = normalize(df["daily_traffic"])
    df["target_match_score"] = df.apply(lambda r: target_score(r, criteria.get("target")), axis=1)
    df["poi_score"] = df.apply(lambda r: poi_score(r, criteria.get("objective"), criteria.get("industry")), axis=1)
    df["visibility_component"] = df["visibility_score"]
    df["constraint_score"] = df.apply(constraint_score, axis=1)

    df["smart_score"] = (
        0.30 * df["availability_score"] +
        0.20 * df["audience_score"] +
        0.20 * df["target_match_score"] +
        0.15 * df["poi_score"] +
        0.10 * df["visibility_component"] +
        0.05 * df["constraint_score"]
    ).round(2)

    df = df.sort_values("smart_score", ascending=False).head(int(criteria.get("top_k") or 20))
    df["explanation"] = df.apply(explain, axis=1)

    results = df[[
        "panel_id", "city", "latitude", "longitude", "district", "format",
        "screen_type", "visibility_score", "daily_traffic", "audience_csp_plus",
        "audience_young_active", "availability", "mall_name", "poi_nearby",
        "price_per_day", "smart_score", "explanation"
    ]].to_dict(orient="records")

    avg_score = round(sum([r["smart_score"] for r in results]) / len(results), 2) if results else 0
    reach = int(sum([r["daily_traffic"] for r in results]))

    return {
        "summary": f"{len(results)} panneaux recommandés avec un score moyen de {avg_score}. Audience potentielle quotidienne estimée : {reach:,}.",
        "criteria": criteria,
        "estimated_daily_reach": reach,
        "average_score": avg_score,
        "results": results
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
