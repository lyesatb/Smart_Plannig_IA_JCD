from __future__ import annotations

import re
import time
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.llm.throttle import wait_llm_slot
from app.llm.usage import groq_rate_limit_hits, record_groq_call, record_groq_rate_limit


def _is_rate_limit(err: Exception) -> bool:
    err_s = str(err).lower()
    return (
        "429" in err_s
        or "rate" in err_s
        or "limit" in err_s
        or "too many" in err_s
        or "tokens per minute" in err_s
    )


def _is_daily_quota_exhausted(err: Exception) -> bool:
    err_s = str(err).lower()
    return "tokens per day" in err_s or "tpd" in err_s


def _retry_delay(attempt: int, err: Exception, base_delay_s: float) -> float:
    m = re.search(r"retry[_\s-]?after[:\s]+(\d+(?:\.\d+)?)", str(err), re.I)
    if m:
        return max(float(m.group(1)), base_delay_s)
    return base_delay_s * (2**attempt) + 1.0


def invoke_with_retry(
    llm: BaseChatModel,
    prompt: str,
    *,
    max_retries: int = 3,
    base_delay_s: float = 2.0,
    min_interval_s: float = 2.0,
    fail_fast_rate_limit: bool = False,
) -> Any | None:
    """Appel LLM avec throttle global + backoff court (évite les blocages 3+ min)."""
    last_err: Exception | None = None
    for attempt in range(max_retries):
        wait_llm_slot(min_interval_s)
        try:
            resp = llm.invoke(prompt)
            record_groq_call()
            return resp
        except Exception as e:
            last_err = e
            if _is_daily_quota_exhausted(e):
                break
            if _is_rate_limit(e):
                record_groq_rate_limit()
                if fail_fast_rate_limit or groq_rate_limit_hits() >= 2:
                    break
                if attempt >= max_retries - 1:
                    break
                time.sleep(min(12.0, _retry_delay(attempt, e, base_delay_s)))
                continue
            if attempt >= max_retries - 1:
                break
            time.sleep(min(6.0, _retry_delay(attempt, e, base_delay_s)))
    if last_err:
        raise last_err
    return None
