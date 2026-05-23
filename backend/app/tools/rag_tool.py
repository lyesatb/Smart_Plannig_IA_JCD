from __future__ import annotations

from typing import Any

from app.config.settings import get_settings
from app.llm.factory import get_chat_llm
from app.llm.invoke import invoke_with_retry
from app.llm.router import GroqTask
from app.rag.chroma_store import get_vectorstore


def _summarize_matches(query: str, matches: list[dict[str, Any]]) -> str | None:
    """Synthèse courte des extraits RAG via Groq 8B (économie tokens vs 70B)."""
    settings = get_settings()
    if not settings.llm_enabled() or not matches:
        return None
    snippets = "\n".join(
        f"- {(m.get('content') or '')[:200]}"
        for m in matches[:4]
        if m.get("content")
    )
    if not snippets:
        return None
    llm = get_chat_llm(settings, task=GroqTask.RAG)
    prompt = (
        "Tu es expert planning DOOH JCDecaux. Résume en 2 phrases max les règles utiles "
        f"pour cette requête (pas de liste, pas de JSON).\n"
        f"Requête : {query}\n"
        f"Extraits :\n{snippets}\n"
    )
    try:
        resp = invoke_with_retry(llm, prompt, max_retries=2, min_interval_s=2.0)
        if resp is None:
            return None
        text = (getattr(resp, "content", None) or str(resp)).strip()
        return text[:500] if text else None
    except Exception:
        return None


def rag_tool(query: str, k: int = 4, *, summarize: bool = True) -> dict[str, Any]:
    settings = get_settings()
    vs = get_vectorstore(settings)

    results = vs.similarity_search(query, k=k)
    matches = [
        {
            "content": r.page_content,
            "source": (r.metadata or {}).get("source"),
        }
        for r in results
    ]
    out: dict[str, Any] = {
        "query": query,
        "k": k,
        "matches": matches,
        "llm_task": GroqTask.RAG.value,
        "llm_model": settings.groq_model_fast if settings.groq_api_key else None,
    }
    if summarize and matches:
        summary = _summarize_matches(query, matches)
        if summary:
            out["summary"] = summary
    return out
