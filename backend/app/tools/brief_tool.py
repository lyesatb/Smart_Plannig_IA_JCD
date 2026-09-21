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
    duration_days: int = 7
    industry: str | None = None
    top_k: int | None = None
    per_city: int | None = None
    city_quotas: dict[str, int] | None = None
    enseigne: str | None = None
    arrondissement: int | None = None
    max_distance_m: int | None = None


class BriefToolOutput(BaseModel):
    brief: Brief


_SYSTEM = (
    "Tu extrais un brief structuré (DOOH / retail media). "
    "Ne devine pas: si une info n'est pas présente, mets null. "
    "Si plusieurs villes sont citées (Paris, Lyon, Bordeaux…), remplis cities (liste) et laisse city à null. "
    "Une seule ville → city uniquement. "
    "top_k = nombre de panneaux (6-12) si précisé ou déduit du budget; sinon null. "
    "Nombre de panneaux PAR ville : « 5 pour chaque » / « 5 par ville » → per_city=5. "
    "« 8 pour Lyon et 2 pour Paris » → city_quotas={\"Lyon\":8,\"Paris\":2}. "
    "Si « pour chaque / par ville » est présent, remplis per_city (et laisse city_quotas null) : "
    "ignore les nombres qui décrivent un PLAN PRÉCÉDENT (ex. « tu avais mis 8 pour Lyon »). "
    "Proximité d'une enseigne / de magasins (ex. « à proximité des magasins Maison Nicolas ») → "
    "enseigne=\"Nicolas\" (nom court de l'enseigne, sans « magasins »/« maison »). "
    "Arrondissement de Paris (« dans le 15ème », « Paris 15 ») → arrondissement=15 et city=\"Paris\". "
    "Rayon demandé (« à moins de 300 m », « dans un rayon de 1 km ») → max_distance_m en mètres ; sinon null."
)

_SYSTEM_CONVERSATION = (
    "L'INPUT est une conversation : plusieurs demandes successives du même client "
    "(de la plus ancienne à la plus récente). Déduis le brief CUMULÉ actuel. "
    "En cas de contradiction (ex. « Paris » puis « plutôt Lyon »), la DERNIÈRE demande "
    "prime et remplace l'ancienne valeur. Les informations non modifiées restent valables."
)


def brief_extraction_tool(
    message: str,
    latest_message: str | None = None,
    is_conversation: bool = False,
) -> dict[str, Any]:
    """Extraction du brief. `message` peut être une conversation multi-tours ;
    `latest_message` (dernier message client) sert au post-traitement heuristique."""
    settings = get_settings()
    llm = get_chat_llm(settings, task=GroqTask.EXTRACTION)

    schema = BriefToolOutput.model_json_schema()
    system = f"{_SYSTEM}\n{_SYSTEM_CONVERSATION}" if is_conversation else _SYSTEM
    prompt = (
        f"{system}\n\n"
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
    criteria = brief_to_scoring_criteria(brief, latest_message or message)
    out["brief"] = criteria
    return out
