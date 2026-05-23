from __future__ import annotations

import io
from typing import Any, Literal

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
    "rang",
    "justification",
]

ExportScope = Literal["plan", "eligible"]


def _prepare_frames(criteria: dict[str, Any], explanations: dict[str, str] | None):
    eligible, pool, selected, crit, _ineligible = _compute_scored_frames(criteria)
    selected_ids = set(selected["panel_id"].tolist()) if not selected.empty else set()
    llm_texts = explanations or {}
    top_k = int(crit.get("top_k") or len(selected) or 12)
    return eligible, pool, selected, selected_ids, llm_texts, top_k, crit


def _add_justification_columns(
    export_df: pd.DataFrame,
    selected_ids: set,
    llm_texts: dict[str, str],
    *,
    all_rows_retenus: bool = False,
) -> pd.DataFrame:
    export_df = export_df.copy()
    if all_rows_retenus:
        export_df["retenu_plan_media"] = "Oui"
    else:
        export_df["retenu_plan_media"] = export_df["panel_id"].apply(
            lambda pid: "Oui" if pid in selected_ids else "Non"
        )

    def _justification_cell(row: pd.Series) -> str:
        pid = str(row["panel_id"])
        if not all_rows_retenus and pid not in selected_ids:
            return ""
        return str(llm_texts.get(pid) or "").strip()

    export_df["justification"] = export_df.apply(_justification_cell, axis=1)
    return export_df


def build_plan_excel(
    criteria: dict[str, Any],
    recommendation_explanations: dict[str, str] | None = None,
) -> io.BytesIO:
    """Uniquement les panneaux retenus dans le plan (carte UI), avec textes IA."""
    eligible, pool, selected, selected_ids, llm_texts, top_k, crit = _prepare_frames(
        criteria, recommendation_explanations
    )

    if selected.empty:
        out = pd.DataFrame(columns=EXPORT_COLUMNS)
    else:
        export_df = selected.sort_values("smart_score", ascending=False).reset_index(drop=True)
        export_df["rang"] = range(1, len(export_df) + 1)
        export_df = _add_justification_columns(export_df, selected_ids, llm_texts, all_rows_retenus=True)
        cols = [c for c in EXPORT_COLUMNS if c in export_df.columns]
        out = export_df[cols]

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        out.to_excel(writer, index=False, sheet_name="Plan retenu")
        meta = pd.DataFrame(
            [
                {"Paramètre": "Panneaux exportés (plan retenu)", "Valeur": len(selected)},
                {"Paramètre": "Parc éligible (total brief)", "Valeur": len(eligible)},
                {"Paramètre": "top_k", "Valeur": top_k},
                {
                    "Paramètre": "Note",
                    "Valeur": (
                        "Ce fichier = uniquement les panneaux affichés sur la carte, "
                        "avec justification IA quand disponible."
                    ),
                },
            ]
        )
        meta.to_excel(writer, index=False, sheet_name="Synthèse")
    buf.seek(0)
    return buf


def build_eligible_parc_excel(
    criteria: dict[str, Any],
    recommendation_explanations: dict[str, str] | None = None,
) -> io.BytesIO:
    """Tout le parc éligible ; colonne retenu Oui/Non ; justification seulement sur les retenus."""
    eligible, pool, selected, selected_ids, llm_texts, top_k, crit = _prepare_frames(
        criteria, recommendation_explanations
    )

    if eligible.empty:
        out = pd.DataFrame(columns=EXPORT_COLUMNS)
    else:
        export_df = eligible.sort_values("smart_score", ascending=False).reset_index(drop=True)
        export_df["rang"] = range(1, len(export_df) + 1)
        export_df = _add_justification_columns(export_df, selected_ids, llm_texts)
        cols = [c for c in EXPORT_COLUMNS if c in export_df.columns]
        out = export_df[cols]

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        out.to_excel(writer, index=False, sheet_name="Parc éligible")
        meta = pd.DataFrame(
            [
                {"Paramètre": "Panneaux éligibles (export)", "Valeur": len(eligible)},
                {"Paramètre": "Plan retenu (carte)", "Valeur": len(selected)},
                {"Paramètre": "top_k", "Valeur": top_k},
                {
                    "Paramètre": "Pool interne (algo)",
                    "Valeur": f"{len(pool)} panneaux — short-list technique, non exportée",
                },
            ]
        )
        meta.to_excel(writer, index=False, sheet_name="Synthèse")
    buf.seek(0)
    return buf


def build_scoring_pool_excel(
    criteria: dict[str, Any],
    recommendation_explanations: dict[str, str] | None = None,
    *,
    scope: ExportScope = "eligible",
) -> io.BytesIO:
    if scope == "plan":
        return build_plan_excel(criteria, recommendation_explanations)
    return build_eligible_parc_excel(criteria, recommendation_explanations)
