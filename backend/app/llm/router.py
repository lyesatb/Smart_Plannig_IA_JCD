from __future__ import annotations

from enum import Enum
from typing import Any, TYPE_CHECKING

from app.config.settings import Settings

if TYPE_CHECKING:
    from langchain_core.language_models.chat_models import BaseChatModel


class GroqTask(str, Enum):
    """Tout le pipeline LLM → modèle rapide 8B (Groq Free Tier)."""

    EXTRACTION = "extraction"
    RAG = "rag"
    REASONING_FINAL = "reasoning_final"


def model_for_task(settings: Settings, task: GroqTask) -> str:
    return settings.groq_model_fast


def routing_label(settings: Settings) -> dict[str, str]:
    fast = settings.groq_model_fast
    return {
        "extraction": fast,
        "rag": fast,
        "reasoning_final": fast,
    }


def _is_quota_error(err: Exception) -> bool:
    s = str(err).lower()
    return (
        "429" in s
        or "rate" in s
        or "limit" in s
        or "tokens per day" in s
        or "tokens per minute" in s
        or "tpd" in s
        or "tpm" in s
    )


def probe_groq_model(settings: Settings, model: str) -> dict[str, Any]:
    """Test léger (1 appel) — visible dans le dashboard Groq Metrics."""
    from app.llm.factory import get_chat_llm
    from app.llm.invoke import invoke_with_retry

    if not settings.groq_api_key:
        return {"model": model, "ok": False, "error": "no_api_key"}
    try:
        llm = get_chat_llm(settings, model=model)
        resp = invoke_with_retry(
            llm,
            "Réponds uniquement par le mot OK.",
            max_retries=1,
            min_interval_s=1.0,
            base_delay_s=8.0,
        )
        text = (getattr(resp, "content", None) or str(resp) if resp else "").strip()
        return {"model": model, "ok": bool(text), "error": None if text else "empty_response"}
    except Exception as e:
        return {"model": model, "ok": False, "error": type(e).__name__}


def resolve_panel_llm(settings: Settings) -> tuple["BaseChatModel", str, bool]:
    """Textes panneaux = 8B uniquement."""
    from app.llm.factory import get_chat_llm

    fast = settings.groq_model_fast
    return (
        get_chat_llm(settings, model=fast, planner_copy=True),
        fast,
        False,
    )
