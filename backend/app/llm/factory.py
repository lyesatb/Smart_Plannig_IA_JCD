from __future__ import annotations

import json
import re
from typing import Any

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.config.settings import Settings
from app.llm.router import GroqTask, model_for_task


GROQ_OPENAI_COMPAT_BASE = "https://api.groq.com/openai/v1"


def _http_client(settings: Settings) -> httpx.Client:
    verify = not settings.llm_skip_ssl_verify
    # trust_env=True : respecte HTTP_PROXY / HTTPS_PROXY du réseau entreprise
    return httpx.Client(verify=verify, timeout=120.0, trust_env=True)


def get_chat_llm(
    settings: Settings,
    *,
    task: GroqTask | str | None = None,
    model: str | None = None,
    temperature: float | None = None,
    creative_copy: bool = False,
    factual_copy: bool = False,
    planner_copy: bool = False,
) -> BaseChatModel:
    """Groq (OpenAI-compatible) or OpenAI chat model.

    task: extraction | rag | reasoning_final → 8B (GROQ_MODEL_FAST).
    model: force un modèle Groq si besoin.
    planner_copy: justifications plan média (8B).
    """
    if task is None and planner_copy:
        task = GroqTask.REASONING_FINAL
    if isinstance(task, str):
        task = GroqTask(task)
    max_tokens: int | None = None
    if planner_copy:
        temp = 0.55
        max_tokens = 2048
    elif factual_copy:
        temp = 0.2
    elif creative_copy:
        temp = 0.55
    else:
        temp = 0.0 if temperature is None else float(temperature)

    http_client = _http_client(settings)

    if settings.groq_api_key:
        groq_model = model or (model_for_task(settings, task) if task else settings.groq_model_fast)
        groq_kw: dict = {
            "model": groq_model,
            "api_key": settings.groq_api_key,
            "base_url": settings.groq_base_url or GROQ_OPENAI_COMPAT_BASE,
            "temperature": temp,
            "http_client": http_client,
        }
        if max_tokens is not None:
            groq_kw["max_tokens"] = max_tokens
        return ChatOpenAI(**groq_kw)
    if settings.openai_api_key:
        return ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=temp,
            http_client=http_client,
        )
    raise RuntimeError("Aucune clé LLM configurée (GROQ_API_KEY ou OPENAI_API_KEY sk-/proj-).")


def parse_llm_json(content: str) -> dict[str, Any]:
    """Parse JSON object from LLM output; strips optional ```json fences."""
    data = parse_llm_json_any(content)
    if isinstance(data, dict):
        return data
    raise ValueError("Le LLM n'a pas renvoyé un objet JSON (dict).")


def parse_llm_json_any(content: str) -> Any:
    """Parse JSON (objet ou tableau) depuis la sortie LLM."""
    text = (content or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence:
        text = fence.group(1).strip()
    return json.loads(text)
