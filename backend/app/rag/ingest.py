from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from langchain_core.documents import Document

from app.config.settings import get_settings
from app.rag.chroma_store import get_vectorstore


@dataclass(frozen=True)
class IngestResult:
    files: int
    chunks: int


def ingest_rag_docs(docs_dir: Path | None = None) -> IngestResult:
    settings = get_settings()
    vs = get_vectorstore(settings)

    base_dir = docs_dir or (Path(__file__).resolve().parents[1] / "rag_docs")
    md_files = sorted(base_dir.glob("*.md"))

    documents: list[Document] = []
    for f in md_files:
        content = f.read_text(encoding="utf-8")
        documents.append(Document(page_content=content, metadata={"source": f.name}))

    if documents:
        try:
            count = int(vs._collection.count())  # type: ignore[attr-defined]
        except Exception:
            count = 0
        if count == 0:
            vs.add_documents(documents)

    return IngestResult(files=len(md_files), chunks=len(documents))

