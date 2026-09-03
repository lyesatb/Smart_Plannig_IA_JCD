from pathlib import Path

import numpy as np
import pandas as pd

from app.services.analytics import build_recommendation_analytics
from app.services.geo import add_arrondissement_column, haversine_matrix_m, stores_for

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "panels.csv"
PANELS = add_arrondissement_column(pd.read_csv(DATA_PATH))

DEFAULT_RADIUS_M = 500
# Rayons successifs si trop peu de faces autour des magasins (on élargit progressivement).
RADIUS_STEPS_M = (500, 800, 1200, 2000, 3500)

def normalize(series):
    min_v = series.min()
    max_v = series.max()
    if max_v == min_v:
        return series * 0
    return (series - min_v) / (max_v - min_v) * 100

def poi_criterion_tokens(criteria: dict | None) -> set[str]:
    """POI demandé dans le brief (champ poi et/ou objectif)."""
    if not criteria:
        return set()
    tokens: set[str] = set()
    for raw in (criteria.get("poi"), criteria.get("objective")):
        if not raw:
            continue
        s = str(raw).lower()
        if "gare" in s:
            tokens.add("gare")
        if "aéroport" in s or "aeroport" in s:
            tokens.add("aéroport")
        if "université" in s or "universite" in s or "campus" in s:
            tokens.add("université")
        if "centre commercial" in s or "retail" in s or "shopping" in s:
            tokens.add("centre commercial")
        if "cinéma" in s or "cinema" in s:
            tokens.add("cinéma")
        if "stade" in s:
            tokens.add("stade")
        if "restaurant" in s:
            tokens.add("restaurant")
    return tokens


def panel_matches_poi_criterion(row, tokens: set[str]) -> bool:
    if not tokens:
        return True
    poi = str(row.get("poi_nearby") or "").lower()
    district = str(row.get("district") or "").lower()
    for t in tokens:
        if t in poi or poi == t:
            return True
        if t == "centre commercial" and "zone commerciale" in district:
            return True
    return False


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

def poi_score(row, objective, industry, poi_criterion=None):
    score = 50
    poi = str(row["poi_nearby"]).lower()
    district = str(row["district"]).lower()

    crit_tokens = poi_criterion_tokens(
        {"poi": poi_criterion, "objective": objective}
    )
    if crit_tokens:
        if panel_matches_poi_criterion(row, crit_tokens):
            score += 45
        else:
            score -= 35

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
        if "gare" in obj and poi == "gare":
            score += 35
        if "couverture" in obj:
            score += 10
        if "premium" in obj and ("premium" in district or "affaires" in district):
            score += 25

    return max(0, min(score, 100))

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
    brief_poi = (criteria.get("poi") or "").lower()
    if poi_val:
        if brief_poi and panel_matches_poi_criterion(row, poi_criterion_tokens(criteria)):
            reasons.append(f"aligné brief POI : {criteria.get('poi')}")
        elif "gare" in objective and poi_val.lower() == "gare":
            reasons.append("emplacement proche d'une gare")
        else:
            reasons.append(f"POI : {poi_val}")

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

    # Arrondissement (Paris) demandé dans le brief : « dans le 15ème »
    arrondissement = criteria.get("arrondissement")
    enseigne = criteria.get("enseigne")
    if arrondissement and not enseigne and "arrondissement" in df.columns:
        mask = (df["arrondissement"] == int(arrondissement)).fillna(False).astype(bool)
        sub = df[mask]
        if not sub.empty:
            df = sub

    poi_tokens = poi_criterion_tokens(criteria)
    if poi_tokens:
        df = df[df.apply(lambda r: panel_matches_poi_criterion(r, poi_tokens), axis=1)]

    if df.empty:
        empty = df.copy()
        return empty, empty, empty, criteria, ineligible

    # Proximité d'une enseigne : distance de chaque face au magasin le plus proche
    stores_used = None
    radius_applied = None
    if enseigne:
        cities_l = [str(c) for c in (criteria.get("cities") or ([] if not city else [city])) if c]
        stores = stores_for(enseigne, cities=cities_l or None, arrondissement=arrondissement)
        if stores.empty and arrondissement:
            stores = stores_for(enseigne, cities=cities_l or None)
        if not stores.empty:
            dist = haversine_matrix_m(
                df["latitude"].to_numpy(float), df["longitude"].to_numpy(float),
                stores["latitude"].to_numpy(float), stores["longitude"].to_numpy(float),
            )
            nearest_idx = dist.argmin(axis=1)
            df["distance_m"] = np.round(dist.min(axis=1)).astype(int)
            df["nearest_store"] = stores["name"].to_numpy()[nearest_idx]
            df["nearest_store_address"] = stores["address"].to_numpy()[nearest_idx]

            explicit = criteria.get("max_distance_m") is not None
            wanted = int(criteria.get("max_distance_m") or DEFAULT_RADIUS_M)
            want_k = int(criteria.get("top_k") or 12)
            # Rayon demandé explicitement par le client → on le respecte dès qu'il y a au moins
            # 3 faces ; sinon (rayon par défaut) on élargit jusqu'à pouvoir remplir le dispositif.
            min_needed = 3 if explicit else max(6, min(want_k, 15))
            steps = [wanted] + [r for r in RADIUS_STEPS_M if r > wanted]
            within = df[df["distance_m"] <= wanted]
            radius_applied = wanted
            for r in steps:
                within = df[df["distance_m"] <= r]
                radius_applied = r
                if len(within) >= min_needed:
                    break
            if not within.empty:
                df = within.copy()
            df["proximity_score"] = (
                (1.0 - df["distance_m"].astype(float) / float(max(radius_applied, 1))).clip(0, 1) * 100
            )
            stores_used = stores

    df["availability_score"] = df["availability"].apply(lambda x: 100 if bool(x) else 0)
    df["audience_score"] = normalize(df["daily_traffic"])
    df["target_match_score"] = df.apply(lambda r: target_score(r, criteria.get("target")), axis=1)
    df["poi_score"] = df.apply(
        lambda r: poi_score(
            r,
            criteria.get("objective"),
            criteria.get("industry"),
            criteria.get("poi"),
        ),
        axis=1,
    )
    df["visibility_component"] = df["visibility_score"]
    df["constraint_score"] = df.apply(constraint_score, axis=1)

    if "proximity_score" in df.columns:
        # Brief de proximité : ce qui compte = audience + distance au magasin (+ dispo).
        df["smart_score"] = (
            0.25 * df["availability_score"]
            + 0.35 * df["audience_score"]
            + 0.25 * df["proximity_score"]
            + 0.10 * df["target_match_score"]
            + 0.05 * df["visibility_component"]
        ).round(2)
    else:
        df["smart_score"] = (
            0.30 * df["availability_score"]
            + 0.20 * df["audience_score"]
            + 0.20 * df["target_match_score"]
            + 0.15 * df["poi_score"]
            + 0.10 * df["visibility_component"]
            + 0.05 * df["constraint_score"]
        ).round(2)

    if stores_used is not None:
        criteria = {**criteria, "radius_m_applied": radius_applied}

    eligible = df.copy()
    if stores_used is not None:
        eligible.attrs["stores"] = [
            {
                "name": str(s["name"]),
                "address": str(s["address"]),
                "latitude": float(s["latitude"]),
                "longitude": float(s["longitude"]),
                "arrondissement": int(s["arrondissement"]) if pd.notna(s["arrondissement"]) else None,
            }
            for _, s in stores_used.iterrows()
        ]
        eligible.attrs["radius_m"] = radius_applied

    quota_map = _resolve_city_quotas(criteria, df)
    if quota_map:
        selected = _pick_by_city_quota(df, quota_map, criteria)
        top_k = int(len(selected))
        criteria = {**criteria, "top_k": top_k}
        pool = df.sort_values("smart_score", ascending=False).head(max(top_k * 8, 60))
        return eligible, pool, selected, criteria, ineligible

    top_k = int(criteria.get("top_k") or 12)
    top_k = max(6, min(top_k, 15))
    criteria = {**criteria, "top_k": top_k}

    pool = df.sort_values("smart_score", ascending=False).head(max(top_k * 8, 60))
    selected = _diversified_pick(pool, top_k, criteria)
    return eligible, pool, selected, criteria, ineligible


def _resolve_city_quotas(criteria: dict, df: pd.DataFrame) -> dict[str, int]:
    """Mappe ville(minuscule) -> nombre de panneaux voulu, depuis city_quotas / per_city."""
    quotas = criteria.get("city_quotas")
    if isinstance(quotas, dict) and quotas:
        return {str(k).lower(): max(1, int(v)) for k, v in quotas.items() if v}

    per_city = criteria.get("per_city")
    if per_city:
        n = max(1, int(per_city))
        cities = criteria.get("cities")
        if isinstance(cities, list) and cities:
            targets = [str(c).lower() for c in cities if c]
        elif criteria.get("city"):
            targets = [str(criteria["city"]).lower()]
        else:
            targets = sorted(df["city"].astype(str).str.lower().unique().tolist())
        return {c: n for c in targets}
    return {}


def _pick_by_city_quota(
    df: pd.DataFrame, quota_map: dict[str, int], criteria: dict
) -> pd.DataFrame:
    """Sélectionne exactement N panneaux par ville (diversifiés, meilleurs scores)."""
    parts: list[pd.DataFrame] = []
    for city_l, n in quota_map.items():
        if n <= 0:
            continue
        sub = df[df["city"].astype(str).str.lower() == city_l]
        if sub.empty:
            continue
        pool_c = sub.sort_values("smart_score", ascending=False).head(max(n * 8, 40))
        picked = _diversified_pick(
            pool_c, n, {**criteria, "top_k": n, "cities": None, "city": city_l}
        )
        parts.append(picked)
    if not parts:
        return df.iloc[0:0]
    return pd.concat(parts).sort_values("smart_score", ascending=False)

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
    lock_poi = bool(poi_criterion_tokens(criteria))

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

            if d in used_district or f in used_format:
                continue
            if not lock_poi and p in used_poi:
                continue

            round_pick.append(row)
            used_district.add(d)
            if not lock_poi:
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
            if not lock_poi and p in used_poi:
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

    analytics = build_recommendation_analytics(eligible, pool, df, criteria, ineligible)

    # Base JCDecaux HEBDOMADAIRE : daily_traffic = audience PAR SEMAINE.
    duration_days = int(criteria.get("duration_days") or 14)
    weeks = duration_days / 7.0
    duration_weeks = int(round(weeks)) if abs(weeks - round(weeks)) < 0.05 else round(weeks, 1)
    df = df.copy()
    df["impressions"] = (df["daily_traffic"].astype(float) * weeks).round().astype(int)

    # Explication par défaut (distance + audience, jamais de score). Le LLM peut la réécrire ensuite.
    from app.tools.panel_copy_tool import _fallback_explanation

    explanations: list[str] = []
    total = len(df)
    for i, (_, row) in enumerate(df.iterrows()):
        panel = row.to_dict()
        for k in ("distance_m", "arrondissement"):
            v = panel.get(k)
            if v is not None and not (isinstance(v, float) and pd.isna(v)) and v is not pd.NA:
                panel[k] = int(v)
            else:
                panel[k] = None
        explanations.append(
            _fallback_explanation(panel, criteria, i, rank=i + 1, total=total, existing=explanations)
        )
    df["explanation"] = explanations
    for col in ("distance_m", "nearest_store", "nearest_store_address", "address"):
        if col not in df.columns:
            df[col] = None
    if "arrondissement" not in df.columns:
        df["arrondissement"] = None

    cols = [
        "panel_id", "city", "arrondissement", "latitude", "longitude", "address", "district", "format",
        "screen_type", "visibility_score", "daily_traffic", "impressions", "audience_csp_plus",
        "audience_young_active", "availability", "mall_name", "poi_nearby",
        "price_per_day", "distance_m", "nearest_store", "nearest_store_address",
        "smart_score", "explanation",
    ]
    results = df[cols].to_dict(orient="records")
    for r in results:
        # JSON-friendly : NA pandas -> None, entiers propres
        for k in ("arrondissement", "distance_m"):
            v = r.get(k)
            r[k] = None if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NA else int(v)
        for k in ("nearest_store", "nearest_store_address", "address"):
            v = r.get(k)
            if v is None or (isinstance(v, float) and pd.isna(v)):
                r[k] = None

    avg_score = round(sum([r["smart_score"] for r in results]) / len(results), 2) if results else 0
    reach = int(sum([r["daily_traffic"] for r in results]))  # passages/semaine (base hebdo)
    impressions = int(sum([r["impressions"] for r in results]))
    # Budget = somme, par panneau, du prix/jour × nombre de jours de campagne.
    budget = int(round(sum(float(r.get("price_per_day") or 0) * duration_days for r in results)))
    agglomerations = sorted({r["city"] for r in results if r.get("city")})

    stores = eligible.attrs.get("stores") if hasattr(eligible, "attrs") else None
    radius_m = eligible.attrs.get("radius_m") if hasattr(eligible, "attrs") else None
    dists = [r["distance_m"] for r in results if r.get("distance_m") is not None]
    distance_stats = (
        {
            "min_m": int(min(dists)),
            "max_m": int(max(dists)),
            "avg_m": int(round(sum(dists) / len(dists))),
        }
        if dists
        else None
    )

    enseigne = criteria.get("enseigne")
    arr = criteria.get("arrondissement")
    where = ", ".join(agglomerations) if agglomerations else "la zone demandée"
    if arr and agglomerations == ["Paris"]:
        where = f"Paris {arr}e"
    def _fmt(n: int) -> str:
        return f"{int(n):,}".replace(",", " ")

    def _weeks_txt(w) -> str:
        return f"{w} semaine{'s' if (isinstance(w, (int, float)) and w >= 2) else ''}"

    dur_txt = _weeks_txt(duration_weeks)
    if enseigne and distance_stats:
        summary = (
            f"{len(results)} faces retenues à {where}, toutes à moins de {distance_stats['max_m']} m "
            f"d'un magasin {enseigne} (distance moyenne {distance_stats['avg_m']} m). "
            f"Audience estimée : {_fmt(reach)} passages/semaine, soit ≈ {_fmt(impressions)} impressions "
            f"sur {dur_txt}. Budget estimé : {_fmt(budget)} €."
        )
    else:
        summary = (
            f"{len(results)} faces retenues à {where}. Audience estimée : {_fmt(reach)} passages/semaine, "
            f"soit ≈ {_fmt(impressions)} impressions sur {dur_txt}. Budget estimé : {_fmt(budget)} €."
        )

    return {
        "summary": summary,
        "criteria": criteria,
        "eligible_count": int(len(eligible)),
        "pool_internal_count": int(len(pool)),
        "export_row_count": int(len(eligible)),
        "estimated_weekly_reach": reach,
        "estimated_impressions": impressions,
        "estimated_budget": budget,
        "duration_days": duration_days,
        "duration_weeks": duration_weeks,
        "faces": int(len(results)),
        "agglomerations": agglomerations,
        "agglomeration_count": len(agglomerations),
        "distance_stats": distance_stats,
        "radius_m": radius_m,
        "stores": stores or [],
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
