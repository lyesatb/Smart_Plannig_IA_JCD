from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

from app.config.settings import Settings


@dataclass(frozen=True)
class RagDoc:
    id: str
    content: str
    source: str


def get_embeddings(settings: Settings):
    """OpenAI embeddings (payant) ou FastEmbed local (léger, CPU, gratuit)."""
    if settings.embedding_backend == "openai" and settings.openai_api_key:
        return OpenAIEmbeddings(
            model=settings.openai_embeddings_model,
            api_key=settings.openai_api_key,
        )
    from langchain_community.embeddings.fastembed import FastEmbedEmbeddings

    primary = settings.fastembed_model
    fallbacks = (
        "BAAI/bge-small-en-v1.5",
        "intfloat/e5-small-v2",
        "sentence-transformers/all-MiniLM-L6-v2",
    )
    for name in (primary, *fallbacks):
        if not name:
            continue
        try:
            return FastEmbedEmbeddings(model_name=name)
        except Exception:
            continue
    raise RuntimeError(
        "Aucun modèle FastEmbed disponible. Vérifiez FASTEMBED_MODEL."
    )


def get_vectorstore(settings: Settings) -> Chroma:
    persist_dir = Path(settings.chroma_persist_dir)
    persist_dir.mkdir(parents=True, exist_ok=True)

    embeddings = get_embeddings(settings)

    return Chroma(
        collection_name=settings.rag_collection,
        persist_directory=str(persist_dir),
        embedding_function=embeddings,
    )
