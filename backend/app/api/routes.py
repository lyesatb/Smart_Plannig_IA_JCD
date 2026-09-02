from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

import httpx

from app.config.settings import get_settings
from app.services.recommendation_service import recommend_panels, get_kpis, get_panels_preview
from app.services.geo import list_enseignes, normalize_enseigne
from app.services.export_service import build_eligible_parc_excel, build_plan_excel
from app.services.chat_service import handle_chat
from app.rag.ingest import ingest_rag_docs
from app.tools.rag_tool import rag_tool
from app.llm.factory import get_chat_llm
from app.llm.router import GroqTask, probe_groq_model, routing_label

router = APIRouter()

class RecommendationRequest(BaseModel):
    city: Optional[str] = None
    cities: Optional[list[str]] = None
    target: Optional[str] = None
    industry: Optional[str] = None
    budget: Optional[float] = None
    duration_days: Optional[int] = 14
    objective: Optional[str] = "performance"
    poi: Optional[str] = None
    top_k: Optional[int] = 20
    per_city: Optional[int] = None
    city_quotas: Optional[dict[str, int]] = None
    enseigne: Optional[str] = None
    arrondissement: Optional[int] = None
    max_distance_m: Optional[int] = None


class ExportScoringPoolRequest(RecommendationRequest):
    """Critères + textes IA déjà générés pour les panneaux retenus."""
    recommendation_explanations: Optional[dict[str, str]] = None

class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[list[ChatTurn]] = None
    prior_criteria: Optional[dict] = None

class RagQueryRequest(BaseModel):
    query: str
    k: Optional[int] = 4

@router.get("/health/llm")
def health_llm():
    """Diagnostic Groq/OpenAI (sans exposer de secret)."""
    settings = get_settings()
    out = {
        "llm_enabled": settings.llm_enabled(),
        "provider": "groq" if settings.groq_api_key else ("openai" if settings.openai_api_key else None),
        "groq_model": settings.groq_model if settings.groq_api_key else None,
        "ssl_verify": not settings.llm_skip_ssl_verify,
        "groq_reachable": False,
        "groq_chat_ok": False,
        "error": None,
    }
    if not settings.llm_enabled():
        out["error"] = "no_api_key"
        return out

    out["api_key_configured"] = bool(settings.groq_api_key)
    out["probe_8b"] = probe_groq_model(settings, settings.groq_model_fast)
    out["probe_70b"] = probe_groq_model(settings, settings.groq_model_quality)

    verify = not settings.llm_skip_ssl_verify
    try:
        r = httpx.get(
            (settings.groq_base_url or "https://api.groq.com/openai/v1").rstrip("/") + "/models",
            timeout=15.0,
            verify=verify,
        )
        out["groq_reachable"] = r.status_code < 500
    except Exception as e:
        out["error"] = f"reachability:{type(e).__name__}"
        return out

    try:
        llm = get_chat_llm(settings, task=GroqTask.EXTRACTION)
        resp = llm.invoke("Réponds uniquement par le mot OK.")
        text = (getattr(resp, "content", None) or str(resp)).strip()
        out["groq_chat_ok"] = len(text) > 0
    except Exception as e:
        out["error"] = f"chat:{type(e).__name__}"

    return out


@router.get("/kpis")
def kpis():
    return get_kpis()

@router.get("/panels")
def panels(city: Optional[str] = None, limit: int = 200):
    return get_panels_preview(city=city, limit=limit)

@router.post("/recommendation")
def recommendation(req: RecommendationRequest):
    data = req.model_dump(exclude_none=True)
    if data.get("enseigne"):
        data["enseigne"] = normalize_enseigne(data["enseigne"]) or data["enseigne"]
    return recommend_panels(data)


@router.get("/enseignes")
def enseignes():
    """Enseignes disponibles (magasins simulés) + arrondissements de Paris, pour les filtres."""
    return {
        "enseignes": list_enseignes(),
        "arrondissements": list(range(1, 21)),
        "distances_m": [300, 500, 800, 1200, 2000],
    }

@router.post("/chat")
def chat(req: ChatRequest):
    history = [t.model_dump() for t in (req.history or [])]
    return handle_chat(req.message, history=history, prior_criteria=req.prior_criteria)


@router.post("/export/plan-retenu")
def export_plan_retenu(req: ExportScoringPoolRequest):
    """Excel : uniquement les panneaux du plan affiché (carte), avec justifications IA."""
    data = req.model_dump(exclude_none=True)
    explanations = data.pop("recommendation_explanations", None) or {}
    buf = build_plan_excel(data, explanations)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="plan_retenu_jcdecaux.xlsx"'},
    )


@router.post("/export/parc-eligible")
def export_parc_eligible(req: ExportScoringPoolRequest):
    """Excel : tout le parc éligible après filtres brief."""
    data = req.model_dump(exclude_none=True)
    explanations = data.pop("recommendation_explanations", None) or {}
    buf = build_eligible_parc_excel(data, explanations)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="parc_eligible_jcdecaux.xlsx"'},
    )


@router.post("/export/scoring-pool")
def export_scoring_pool(req: ExportScoringPoolRequest):
    """Alias rétrocompat : export parc éligible complet."""
    return export_parc_eligible(req)

@router.post("/rag/ingest")
def rag_ingest():
    result = ingest_rag_docs()
    return {"status": "ok", "files": result.files, "chunks": result.chunks}

@router.post("/rag/query")
def rag_query(req: RagQueryRequest):
    return rag_tool(req.query, k=req.k or 4)
