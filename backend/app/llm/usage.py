from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_calls_this_request = 0
_rate_limit_hits = 0
_last_call_at: float | None = None


def reset_groq_usage() -> None:
    global _calls_this_request, _rate_limit_hits, _last_call_at
    with _lock:
        _calls_this_request = 0
        _rate_limit_hits = 0
        _last_call_at = None


def record_groq_call() -> None:
    global _calls_this_request, _last_call_at
    with _lock:
        _calls_this_request += 1
        _last_call_at = time.time()


def record_groq_rate_limit() -> None:
    global _rate_limit_hits
    with _lock:
        _rate_limit_hits += 1


def groq_rate_limit_hits() -> int:
    with _lock:
        return _rate_limit_hits


def get_groq_usage() -> dict:
    with _lock:
        return {
            "groq_api_calls": _calls_this_request,
            "groq_rate_limit_hits": _rate_limit_hits,
            "groq_last_call_at": (
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_last_call_at))
                if _last_call_at
                else None
            ),
        }
