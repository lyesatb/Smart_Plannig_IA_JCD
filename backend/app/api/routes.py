from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.services.recommendation_service import recommend_panels, get_kpis, get_panels_preview
from app.services.chat_service import handle_chat

router = APIRouter()

class RecommendationRequest(BaseModel):
    city: Optional[str] = None
    target: Optional[str] = None
    industry: Optional[str] = None
    budget: Optional[float] = None
    duration_days: Optional[int] = 14
    objective: Optional[str] = "performance"
    top_k: Optional[int] = 20

class ChatRequest(BaseModel):
    message: str

@router.get("/kpis")
def kpis():
    return get_kpis()

@router.get("/panels")
def panels(city: Optional[str] = None, limit: int = 200):
    return get_panels_preview(city=city, limit=limit)

@router.post("/recommendation")
def recommendation(req: RecommendationRequest):
    return recommend_panels(req.dict())

@router.post("/chat")
def chat(req: ChatRequest):
    return handle_chat(req.message)
