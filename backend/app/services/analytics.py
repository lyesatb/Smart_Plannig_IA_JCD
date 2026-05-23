from __future__ import annotations

from typing import Any

import pandas as pd


SCORE_BUCKETS = [
    (0, 50, "0-50"),
    (50, 60, "50-60"),
    (60, 70, "60-70"),
    (70, 80, "70-80"),
    (80, 90, "80-90"),
    (90, 101, "90-100"),
]


def _score_histogram(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty or "smart_score" not in df.columns:
        return [{"bucket": b[2], "count": 0} for b in SCORE_BUCKETS]
    scores = df["smart_score"]
    return [
        {
            "bucket": label,
            "count": int(((scores >= lo) & (scores < hi)).sum()),
        }
        for lo, hi, label in SCORE_BUCKETS
    ]


def _count_by_column(df: pd.DataFrame, col: str, limit: int = 10) -> list[dict[str, Any]]:
    if df.empty or col not in df.columns:
        return []
    counts = df[col].fillna("—").astype(str).value_counts().head(limit)
    return [{"label": str(k), "count": int(v)} for k, v in counts.items()]


def _avg(df: pd.DataFrame, col: str) -> float | None:
    if df.empty or col not in df.columns:
        return None
    return round(float(df[col].mean()), 2)


def _plan_insights(
    eligible: pd.DataFrame,
    selected: pd.DataFrame,
) -> dict[str, Any]:
    """Synthèse actionnable : plan retenu vs parc éligible (pas le pool technique Excel)."""
    elig_n = len(eligible)
    rec_n = len(selected)
    elig_avg = _avg(eligible, "smart_score")
    rec_avg = _avg(selected, "smart_score")
    uplift = (
        round(rec_avg - elig_avg, 1)
        if rec_avg is not None and elig_avg is not None
        else None
    )

    reach = 0
    if not selected.empty and "daily_traffic" in selected.columns:
        reach = int(selected["daily_traffic"].fillna(0).sum())

    top_poi = _count_by_column(selected, "poi_nearby", limit=1)
    top_format = _count_by_column(selected, "format", limit=1)
    top_city = _count_by_column(selected, "city", limit=3)

    min_score = max_score = None
    if not selected.empty and "smart_score" in selected.columns:
        s = selected["smart_score"]
        min_score = round(float(s.min()), 1)
        max_score = round(float(s.max()), 1)

    return {
        "selection_rate_pct": round(100.0 * rec_n / elig_n, 2) if elig_n else 0,
        "score_uplift_vs_eligible": uplift,
        "eligible_count": elig_n,
        "score_min": min_score,
        "score_max": max_score,
        "estimated_daily_reach": reach,
        "cities_count": int(selected["city"].nunique()) if not selected.empty and "city" in selected.columns else 0,
        "poi_diversity": int(selected["poi_nearby"].nunique()) if not selected.empty and "poi_nearby" in selected.columns else 0,
        "top_poi": top_poi[0]["label"] if top_poi else None,
        "top_format": top_format[0]["label"] if top_format else None,
        "cities_breakdown": top_city,
    }


def build_selection_rationale(
    eligible: pd.DataFrame,
    pool: pd.DataFrame,
    selected: pd.DataFrame,
    criteria: dict[str, Any],
) -> dict[str, Any]:
    top_k = int(criteria.get("top_k") or len(selected))
    pool_n = int(len(pool))
    rec_n = int(len(selected))
    elig_n = int(len(eligible))

    return {
        "top_k": top_k,
        "pool_size": pool_n,
        "eligible_count": elig_n,
        "recommended_count": rec_n,
        "title": f"Pourquoi {rec_n} panneaux retenus sur {elig_n:,} éligibles ?",
        "summary": (
            f"Le brief filtre le parc : {elig_n:,} panneaux éligibles"
            + (
                f" (POI « {criteria.get('poi')} » uniquement)"
                if criteria.get("poi")
                else " (disponibles, maintenance OK)"
            )
            + f". Le plan média en retient {rec_n} (top_k={top_k}) parmi les meilleurs smart_score."
        ),
        "reasons": [
            f"Plafond plan média : top_k = {top_k} (brief / budget / couverture).",
            *(
                [f"Filtre POI brief : « {criteria.get('poi')} » — seuls les panneaux alignés entrent dans le parc."]
                if criteria.get("poi")
                else ["Diversification : quartiers et formats variés dans le plan."]
            ),
            f"Les {elig_n - rec_n:,} autres panneaux éligibles restent disponibles — export Excel.",
        ],
        "scoring_weights": {
            "disponibilité": "30%",
            "audience_trafic": "20%",
            "affinité_cible": "20%",
            "pertinence_POI_objectif": "15%",
            "visibilité": "10%",
            "contraintes_techniques": "5%",
        },
    }


def build_recommendation_analytics(
    eligible: pd.DataFrame,
    pool: pd.DataFrame,
    selected: pd.DataFrame,
    criteria: dict[str, Any] | None = None,
    ineligible: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """
    Distributions comparatives : tout le parc éligible vs pool scoring vs sélection finale.
    """
    crit = criteria or {}
    avail_pct = (
        round(100.0 * eligible["availability"].sum() / len(eligible), 1) if len(eligible) else 0
    )
    inel = ineligible if ineligible is not None else pd.DataFrame()
    inel_scores = inel.copy()
    if not inel_scores.empty and "smart_score" not in inel_scores.columns:
        inel_scores["smart_score"] = inel_scores.get("visibility_score", 50)

    elig_n = int(len(eligible))
    inel_n = int(len(inel))
    pool_n = int(len(pool))
    rec_n = int(len(selected))

    return {
        "summary": {
            "eligible_panels": elig_n,
            "ineligible_panels": inel_n,
            "scoring_pool": pool_n,
            "recommended": rec_n,
            "filtered_panels": elig_n + inel_n,
            "availability_rate_eligible_pct": avail_pct,
            "pool_internal_count": pool_n,
            "export_excel_rows": elig_n,
        },
        "pipeline": {
            "steps": [
                {
                    "id": "filtered",
                    "label": "Après filtres brief",
                    "count": elig_n + inel_n,
                    "hint": "Villes & critères du brief",
                },
                {
                    "id": "eligible",
                    "label": "Parc éligible",
                    "count": elig_n,
                    "hint": "Scorés et disponibles pour la campagne",
                },
                {
                    "id": "plan",
                    "label": "Plan retenu",
                    "count": rec_n,
                    "hint": f"top_k={int(crit.get('top_k') or rec_n)} affichés sur la carte",
                },
            ],
        },
        "plan_insights": _plan_insights(eligible, selected),
        "averages": {
            "smart_score": {
                "eligible": _avg(eligible, "smart_score"),
                "pool": _avg(pool, "smart_score"),
                "recommended": _avg(selected, "smart_score"),
            },
            "visibility": {
                "eligible": _avg(eligible, "visibility_score"),
                "pool": _avg(pool, "visibility_score"),
                "recommended": _avg(selected, "visibility_score"),
            },
        },
        "selection_rationale": build_selection_rationale(eligible, pool, selected, crit),
        "score_distribution": {
            "eligible": _score_histogram(eligible),
            "ineligible": _score_histogram(inel_scores) if not inel_scores.empty else _score_histogram(inel),
            "scoring_pool": _score_histogram(pool),
            "recommended": _score_histogram(selected),
        },
        "poi_distribution": {
            "eligible": _count_by_column(eligible, "poi_nearby"),
            "recommended": _count_by_column(selected, "poi_nearby"),
        },
        "city_distribution": {
            "eligible": _count_by_column(eligible, "city"),
            "recommended": _count_by_column(selected, "city"),
        },
        "format_distribution": {
            "eligible": _count_by_column(eligible, "format"),
            "recommended": _count_by_column(selected, "format"),
        },
    }
