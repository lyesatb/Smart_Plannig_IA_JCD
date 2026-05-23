import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.rag.ingest import ingest_rag_docs

app = FastAPI(
    title="Smart Planning IA JCDecaux",
    description="MVP IA de recommandation de panneaux DOOH Retail Media",
    version="1.0.0",
)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "*").strip()
if _raw_origins == "*":
    _cors_origins = ["*"]
else:
    _cors_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def _startup_ingest_rag() -> None:
    """Indexe les docs RAG au 1er démarrage (Chroma vide sur Railway)."""
    try:
        ingest_rag_docs()
    except Exception:
        pass

@app.get("/")
def root():
    return {
        "message": "Smart Planning IA JCDecaux API",
        "status": "running",
        "docs": "/docs"
    }
