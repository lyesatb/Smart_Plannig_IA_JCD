from __future__ import annotations

import os
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # Groq (OpenAI-compatible chat API)
    groq_api_key: str | None
    groq_model: str  # rétrocompat = modèle rapide
    groq_model_fast: str
    groq_model_quality: str
    groq_base_url: str

    # OpenAI (optional paid LLM / embeddings)
    openai_api_key: str | None
    openai_model: str
    openai_embeddings_model: str

    # RAG embeddings: "openai" si clé OpenAI + EMBEDDING_BACKEND ; sinon FastEmbed local (CPU, gratuit)
    embedding_backend: str  # "openai" | "huggingface" (valeur = chemin FastEmbed, nom historique)
    fastembed_model: str

    chroma_persist_dir: str
    rag_collection: str

    # Dev / proxy d’entreprise : désactive la vérif SSL TLS vers l’API LLM (Groq/OpenAI)
    llm_skip_ssl_verify: bool

    # Anti rate-limit Groq (~6k TPM) : lots + pause entre appels panel copy
    groq_max_panels_llm: int
    groq_batch_size: int
    groq_batch_delay_s: float
    groq_min_interval_s: float
    groq_panel_copy_retries: int
    groq_between_requests_s: float

    def llm_enabled(self) -> bool:
        return bool(self.groq_api_key) or bool(self.openai_api_key)


def _strip(k: str | None) -> str | None:
    if k is None:
        return None
    s = k.strip()
    if not s or s.lower() in {"your_api_key_here", "changeme", "replace_me"}:
        return None
    return s


def get_openai_env_mismatch_hint() -> str | None:
    """
    Optional hint when no LLM is available but env looks wrong (e.g. GitHub token).
    Does not trigger for valid Groq keys (gsk_).
    """
    raw = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not raw:
        return None
    if raw.startswith("ghp_") or raw.startswith("github_pat_"):
        return (
            "OPENAI_API_KEY semble être un token GitHub, pas une clé LLM. "
            "Utilisez GROQ_API_KEY (gsk_...) pour Groq, ou une clé OpenAI (sk-/proj-)."
        )
    return None


def _env_bool(name: str, default: bool = False) -> bool:
    v = (os.getenv(name) or "").strip().lower()
    if not v:
        return default
    return v in ("1", "true", "yes", "on")


GROQ_MODEL_ALIASES = {
    # Groq a retiré 3.1-70b (fév. 2025) → successeur officiel
    "llama-3.1-70b-versatile": "llama-3.3-70b-versatile",
    "llama3-70b-8192": "llama-3.3-70b-versatile",
}


def _normalize_groq_model(name: str) -> str:
    n = (name or "").strip()
    return GROQ_MODEL_ALIASES.get(n, n)


def _resolve_groq_model_fast() -> str:
    explicit = (os.getenv("GROQ_MODEL_FAST") or os.getenv("GROQ_MODEL") or "").strip()
    if explicit:
        return _normalize_groq_model(explicit)
    return "llama-3.1-8b-instant"


def _resolve_groq_model_quality() -> str:
    explicit = (os.getenv("GROQ_MODEL_QUALITY") or "").strip()
    if explicit:
        return _normalize_groq_model(explicit)
    legacy = (os.getenv("GROQ_MODEL") or "").strip()
    if legacy and "70" in legacy:
        return _normalize_groq_model(legacy)
    return "llama-3.3-70b-versatile"


def get_settings() -> Settings:
    groq = _strip(os.getenv("GROQ_API_KEY"))
    openai_raw = os.getenv("OPENAI_API_KEY")
    openai = _strip(openai_raw)

    # Retrocompat: Groq key stored in OPENAI_API_KEY
    if not groq and openai and openai.startswith("gsk_"):
        groq = openai
        openai = None

    if openai and not re.match(r"^(sk-|proj-)", openai):
        openai = None

    embed_env = (os.getenv("EMBEDDING_BACKEND") or "auto").strip().lower()
    if embed_env == "openai":
        embedding_backend = "openai" if openai else "huggingface"
    elif embed_env == "huggingface":
        embedding_backend = "huggingface"
    else:
        # auto: OpenAI embeddings only if paid OpenAI key is set; else free local HF
        embedding_backend = "openai" if openai else "huggingface"

    groq_fast = _resolve_groq_model_fast()
    groq_quality = _resolve_groq_model_quality()

    return Settings(
        groq_api_key=groq,
        groq_model=groq_fast,
        groq_model_fast=groq_fast,
        groq_model_quality=groq_quality,
        groq_base_url=(os.getenv("GROQ_BASE_URL") or "https://api.groq.com/openai/v1").strip(),
        openai_api_key=openai,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
        openai_embeddings_model=os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-small").strip(),
        embedding_backend=embedding_backend,
        fastembed_model=os.getenv(
            "FASTEMBED_MODEL",
            "BAAI/bge-small-en-v1.5",
        ).strip(),
        chroma_persist_dir=os.getenv("CHROMA_PERSIST_DIR", "app/.chroma").strip(),
        rag_collection=os.getenv("RAG_COLLECTION", "smart_planning_rag_bge").strip(),
        llm_skip_ssl_verify=_env_bool("GROQ_INSECURE_SKIP_SSL_VERIFY", False)
        or _env_bool("LLM_INSECURE_SKIP_SSL_VERIFY", False),
        groq_max_panels_llm=int(os.getenv("GROQ_MAX_PANELS_LLM", "15")),
        groq_batch_size=max(1, int(os.getenv("GROQ_BATCH_SIZE", "8"))),
        groq_batch_delay_s=float(os.getenv("GROQ_BATCH_DELAY_S", "2.0")),
        groq_min_interval_s=float(os.getenv("GROQ_MIN_INTERVAL_S", "2.5")),
        groq_panel_copy_retries=max(0, int(os.getenv("GROQ_PANEL_COPY_RETRIES", "4"))),
        groq_between_requests_s=float(os.getenv("GROQ_BETWEEN_REQUESTS_S", "4")),
    )
