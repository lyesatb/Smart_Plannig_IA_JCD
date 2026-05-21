from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_last_call_at = 0.0
_last_agent_finished_at = 0.0


def mark_agent_finished() -> None:
    global _last_agent_finished_at
    with _lock:
        _last_agent_finished_at = time.time()


def wait_between_agent_requests(min_gap_s: float = 6.0) -> None:
    """Évite 2 clics rapides qui cumulent le quota TPM Groq."""
    global _last_agent_finished_at
    with _lock:
        if _last_agent_finished_at <= 0:
            return
        wait = min_gap_s - (time.time() - _last_agent_finished_at)
    if wait > 0:
        time.sleep(wait)


def wait_llm_slot(min_interval_s: float = 2.5) -> None:
    """Espace les appels Groq (brief + lots panneaux) pour éviter le TPM burst."""
    global _last_call_at
    with _lock:
        now = time.time()
        wait = min_interval_s - (now - _last_call_at)
        if wait > 0:
            time.sleep(wait)
        _last_call_at = time.time()
