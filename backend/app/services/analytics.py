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
        "title": f"Pourquoi {rec_n} panneaux retenus sur {pool_n} dans le pool scoring ?",
        "summary": (
            f"Sur {elig_n:,} panneaux éligibles, le moteur isole les {pool_n} meilleurs scores smart_score "
            f"(disponibilité, audience, cible, POI, visibilité). Seuls {rec_n} sont retenus dans le plan média "
            f"(top_k={top_k}) pour garder un plan lisible et diversifié."
        ),
        "reasons": [
            f"Plafond plan média : top_k = {top_k} (dérivé du brief / budget / couverture).",
            "Diversification : éviter doublons quartier, POI et format dans la sélection finale.",
            f"Les {pool_n - rec_n} autres panneaux du pool restent des alternatives — export Excel ci-dessous.",
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

    return {
        "summary": {
            "eligible_panels": int(len(eligible)),
            "ineligible_panels": int(len(inel)),
            "scoring_pool": int(len(pool)),
            "recommended": int(len(selected)),
            "availability_rate_eligible_pct": avail_pct,
        },
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
