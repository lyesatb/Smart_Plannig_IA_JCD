from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.config.settings import get_settings
from app.llm.factory import get_chat_llm, parse_llm_json
from app.llm.router import GroqTask
from app.llm.invoke import invoke_with_retry
from app.tools.brief_utils import brief_to_scoring_criteria


class Brief(BaseModel):
    city: str | None = None
    cities: list[str] | None = None
    target: str | None = None
    budget: float | None = None
    objective: str | None = None
    poi: str | None = None
    duration_days: int = 14
    industry: str | None = None
    top_k: int | None = None


class BriefToolOutput(BaseModel):
    brief: Brief


_SYSTEM = (
    "Tu extrais un brief structuré (DOOH / retail media). "
    "Ne devine pas: si une info n'est pas présente, mets null. "
    "Si plusieurs villes sont citées (Paris, Lyon, Bordeaux…), remplis cities (liste) et laisse city à null. "
    "Une seule ville → city uniquement. "
    "top_k = nombre de panneaux (6-12) si précisé ou déduit du budget; sinon null."
)


def brief_extraction_tool(message: str) -> dict[str, Any]:
    settings = get_settings()
    llm = get_chat_llm(settings, task=GroqTask.EXTRACTION)

    schema = BriefToolOutput.model_json_schema()
    prompt = (
        f"{_SYSTEM}\n\n"
        "Retourne STRICTEMENT un JSON valide suivant ce schéma.\n"
        f"SCHEMA:\n{schema}\n\n"
        f"INPUT:\n{message}\n"
    )

    resp = invoke_with_retry(llm, prompt, max_retries=3, min_interval_s=1.5)
    content = getattr(resp, "content", None) or str(resp)
    data = parse_llm_json(content)
    # Groq renvoie parfois le brief à la racine sans clé "brief"
    if isinstance(data, dict) and "brief" not in data and any(
        k in data for k in ("city", "cities", "target", "budget", "objective", "industry")
    ):
        data = {"brief": data}
    out = BriefToolOutput.model_validate(data).model_dump()
    brief = out.get("brief") or {}
    criteria = brief_to_scoring_criteria(brief, message)
    out["brief"] = criteria
    return out
