from __future__ import annotations

from typing import Any

from app.config.settings import get_settings
from app.rag.chroma_store import get_vectorstore


def rag_tool(query: str, k: int = 4) -> dict[str, Any]:
    settings = get_settings()
    vs = get_vectorstore(settings)

    results = vs.similarity_search(query, k=k)
    return {
        "query": query,
        "k": k,
        "matches": [
            {
                "content": r.page_content,
                "source": (r.metadata or {}).get("source"),
            }
            for r in results
        ],
    }

