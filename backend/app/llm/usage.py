from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_calls_this_request = 0
_last_call_at: float | None = None


def reset_groq_usage() -> None:
    global _calls_this_request, _last_call_at
    with _lock:
        _calls_this_request = 0
        _last_call_at = None


def record_groq_call() -> None:
    global _calls_this_request, _last_call_at
    with _lock:
        _calls_this_request += 1
        _last_call_at = time.time()


def get_groq_usage() -> dict:
    with _lock:
        return {
            "groq_api_calls": _calls_this_request,
            "groq_last_call_at": (
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_last_call_at))
                if _last_call_at
                else None
            ),
        }
