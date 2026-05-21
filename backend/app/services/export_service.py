from __future__ import annotations

import io
from typing import Any

import pandas as pd

from app.services.recommendation_service import _compute_scored_frames


EXPORT_COLUMNS = [
    "panel_id",
    "city",
    "district",
    "format",
    "screen_type",
    "poi_nearby",
    "mall_name",
    "smart_score",
    "daily_traffic",
    "visibility_score",
    "audience_csp_plus",
    "audience_young_active",
    "availability",
    "price_per_day",
    "retenu_plan_media",
    "rang_pool_score",
    "justification",
]


def build_scoring_pool_excel(
    criteria: dict[str, Any],
    recommendation_explanations: dict[str, str] | None = None,
) -> io.BytesIO:
    """
    Exporte le pool scoring avec justification UNIQUEMENT pour les panneaux retenus (Oui).
    """
    eligible, pool, selected, crit, _ineligible = _compute_scored_frames(criteria)
    llm_texts = recommendation_explanations or {}
    if pool.empty:
        out = pd.DataFrame(columns=EXPORT_COLUMNS)
    else:
        selected_ids = set(selected["panel_id"].tolist())
        export_df = pool.copy().reset_index(drop=True)
        export_df["rang_pool_score"] = range(1, len(export_df) + 1)
        export_df["retenu_plan_media"] = export_df["panel_id"].apply(
            lambda pid: "Oui" if pid in selected_ids else "Non"
        )

        def _justification_cell(row: pd.Series) -> str:
            pid = str(row["panel_id"])
            if pid not in selected_ids:
                return ""
            return str(llm_texts.get(pid) or "").strip()

        export_df["justification"] = export_df.apply(_justification_cell, axis=1)
        cols = [c for c in EXPORT_COLUMNS if c in export_df.columns]
        out = export_df[cols]

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        out.to_excel(writer, index=False, sheet_name="Pool scoring")
        meta = pd.DataFrame(
            [
                {"Paramètre": "Panneaux éligibles", "Valeur": len(eligible)},
                {"Paramètre": "Pool scoring (export)", "Valeur": len(pool)},
                {"Paramètre": "Retenus plan média (UI)", "Valeur": len(selected)},
                {"Paramètre": "top_k", "Valeur": crit.get("top_k")},
            ]
        )
        meta.to_excel(writer, index=False, sheet_name="Synthèse")
    buf.seek(0)
    return buf
