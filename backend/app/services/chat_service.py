import json
import re
from collections import Counter
from typing import Any

from app.agents.smart_planning_agent import run_agent
from app.config.settings import get_settings, get_openai_env_mismatch_hint
from app.llm.factory import get_chat_llm
from app.llm.invoke import invoke_with_retry
from app.llm.router import GroqTask
from app.services.recommendation_service import recommend_panels
from app.tools.brief_utils import brief_to_scoring_criteria


PLAN_KEYS = (
    "city", "cities", "target", "industry", "poi", "objective", "budget",
    "top_k", "per_city", "city_quotas", "enseigne", "arrondissement", "max_distance_m",
    "duration_days",
)


CITY_LIST = ["Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes"]


def _fallback_extract_criteria(message: str):
    lower = message.lower()
    city = None
    cities = []
    for c in CITY_LIST:
        if c.lower() in lower:
            cities.append(c)

    if len(cities) == 1:
        city = cities[0]

    target = None
    if "csp" in lower or "premium" in lower or "luxe" in lower:
        target = "CSP+"
    elif "jeune" in lower or "actif" in lower or "étudiant" in lower:
        target = "jeunes actifs"
    elif "famille" in lower:
        target = "familles"

    industry = None
    for item in ["luxe", "food", "retail", "automobile", "beauté", "sport", "banque", "tech", "santé"]:
        if item in lower:
            industry = item
    if industry is None and "bio" in lower:
        industry = "bio"

    budget = None
    match = re.search(r"(\d+)\s?k", lower)
    if match:
        budget = int(match.group(1)) * 1000
    else:
        match_eur = re.search(r"(\d{2,9})\s*€", lower)
        if match_eur:
            budget = int(match_eur.group(1))

    objective = "performance"
    if "gare" in lower:
        objective = "proximité gare"
    elif "couverture" in lower or "national" in lower:
        objective = "couverture"
    elif "premium" in lower or "luxe" in lower:
        objective = "premium"

    poi = None
    if "gare" in lower:
        poi = "gare"

    # Make output size react to brief (helps KPIs vary per prompt)
    top_k = 10
    if isinstance(budget, int) and budget > 0:
        # rough heuristic: more budget -> more panels
        top_k = max(8, min(30, int(round(budget / 25000))))
    if objective == "couverture":
        top_k = max(top_k, 15)
    if cities and len(cities) >= 3:
        top_k = max(top_k, 18)

    raw = {
        "city": city,
        "cities": cities if len(cities) > 1 else None,
        "target": target,
        "industry": industry,
        "budget": budget,
        "duration_days": 14,
        "objective": objective,
        "poi": poi,
        "top_k": top_k,
    }
    return brief_to_scoring_criteria(raw, message)


def _refine_followup(criteria: dict[str, Any], message: str) -> dict[str, Any]:
    """Ajuste explicitement cible / nombre de panneaux depuis le dernier message
    (utile en mode fallback sans LLM ; le chemin LLM gère déjà le contexte)."""
    lower = (message or "").lower()

    # Changement de cible
    if "csp" in lower or "premium" in lower or "luxe" in lower:
        criteria["target"] = "CSP+"
    elif "jeune" in lower or "actif" in lower or "étudiant" in lower or "etudiant" in lower:
        criteria["target"] = "jeunes actifs"
    elif "famille" in lower:
        criteria["target"] = "familles"

    # Nombre par ville prioritaire → on ne touche pas au top_k global
    if criteria.get("per_city") or criteria.get("city_quotas"):
        return criteria

    # Nombre de panneaux explicite ("15 panneaux", "top 12")
    m = re.search(r"(\d{1,2})\s*(?:panneaux|faces|écrans|ecrans|supports)", lower)
    if not m:
        m = re.search(r"top\s*(\d{1,2})", lower)
    if m:
        criteria["top_k"] = max(6, min(15, int(m.group(1))))
    elif re.search(r"\bplus\b.*(panneaux|faces|supports)|(panneaux|faces|supports).*\bplus\b", lower):
        criteria["top_k"] = min(15, int(criteria.get("top_k") or 10) + 4)
    elif re.search(r"\bmoins\b.*(panneaux|faces|supports)|(panneaux|faces|supports).*\bmoins\b", lower):
        criteria["top_k"] = max(6, int(criteria.get("top_k") or 10) - 4)

    return criteria


def _merge_followup_criteria(
    message: str, prior_criteria: dict[str, Any] | None
) -> dict[str, Any]:
    """Suivi de conversation sans LLM : on repart des critères précédents et on
    applique les nouveautés détectées dans le dernier message (ville, budget, POI…)."""
    if prior_criteria:
        merged = brief_to_scoring_criteria(dict(prior_criteria), message)
        return _refine_followup(merged, message)
    return _fallback_extract_criteria(message)


def _fmt_budget(value: Any) -> str | None:
    try:
        return f"{int(value):,} €".replace(",", " ")
    except (TypeError, ValueError):
        return None


def _criteria_summary(c: dict[str, Any]) -> str:
    bits: list[str] = []
    if c.get("cities"):
        bits.append("villes " + ", ".join(str(x) for x in c["cities"]))
    elif c.get("city"):
        bits.append(str(c["city"]) + (f" {c['arrondissement']}e" if c.get("arrondissement") else ""))
    if c.get("enseigne"):
        bits.append(f"proximité des magasins {c['enseigne']}")
    if c.get("max_distance_m"):
        bits.append(f"rayon {c['max_distance_m']} m")
    if c.get("duration_days"):
        d = int(c["duration_days"])
        bits.append(f"{d // 7} semaines" if d % 7 == 0 else f"{d} jours")
    if c.get("target"):
        bits.append("cible " + str(c["target"]))
    if c.get("industry"):
        bits.append("secteur " + str(c["industry"]))
    if c.get("poi"):
        bits.append("POI " + str(c["poi"]))
    if c.get("objective"):
        bits.append("objectif " + str(c["objective"]))
    budget = _fmt_budget(c.get("budget"))
    if budget:
        bits.append("budget " + budget)
    if c.get("city_quotas"):
        bits.append(
            "répartition " + ", ".join(f"{k}: {v}" for k, v in c["city_quotas"].items())
        )
    elif c.get("per_city"):
        bits.append(f"{c['per_city']} panneaux/ville")
    return ", ".join(bits) if bits else "critères par défaut"


def _criteria_diff(
    prior: dict[str, Any] | None, current: dict[str, Any]
) -> list[str]:
    if not prior:
        return []
    labels = [
        ("city", "ville"),
        ("cities", "villes"),
        ("target", "cible"),
        ("industry", "secteur"),
        ("poi", "POI"),
        ("objective", "objectif"),
        ("budget", "budget"),
        ("top_k", "nombre de panneaux"),
        ("per_city", "panneaux par ville"),
        ("city_quotas", "répartition par ville"),
        ("enseigne", "enseigne"),
        ("arrondissement", "arrondissement"),
        ("max_distance_m", "rayon (m)"),
        ("duration_days", "durée (jours)"),
    ]
    changes: list[str] = []
    for key, label in labels:
        pv, cv = prior.get(key), current.get(key)
        if _norm_val(pv) == _norm_val(cv) or cv in (None, "", [], {}):
            continue
        if key == "budget":
            cv = _fmt_budget(cv) or cv
        elif isinstance(cv, dict):
            cv = ", ".join(f"{k}: {v}" for k, v in cv.items())
        elif isinstance(cv, list):
            cv = ", ".join(str(x) for x in cv)
        changes.append(f"{label} → {cv}")
    return changes


def build_assistant_reply(
    criteria: dict[str, Any],
    recommendation: dict[str, Any],
    prior_criteria: dict[str, Any] | None = None,
    extra_note: str | None = None,
) -> str:
    """Réponse conversationnelle pour le fil de discussion."""
    results = recommendation.get("results") or []
    n = len(results)
    if n == 0:
        return (
            "Je n'ai trouvé aucun panneau pour ces critères. "
            "Essaie d'élargir la ville, le POI ou le budget, et redis-moi ce que tu cherches."
        )

    def _fmt(v: Any) -> str:
        return f"{int(v):,}".replace(",", " ") if isinstance(v, (int, float)) else "—"

    reach = recommendation.get("estimated_weekly_reach")
    impressions = recommendation.get("estimated_impressions")
    budget = recommendation.get("estimated_budget")
    weeks = recommendation.get("duration_weeks")
    dur_txt = f"{weeks} semaine{'s' if isinstance(weeks, (int, float)) and weeks >= 2 else ''}" if weeks else "la période"
    dist = recommendation.get("distance_stats") or {}
    enseigne = criteria.get("enseigne")

    intro = "J'ai ajusté le dispositif" if prior_criteria else "Voici une première proposition de dispositif"
    parts = [f"{intro} ({_criteria_summary(criteria)})."]

    diff = _criteria_diff(prior_criteria, criteria)
    if diff:
        parts.append("Changements pris en compte : " + " ; ".join(diff) + ".")

    audience = f"{n} faces, ≈ {_fmt(reach)} passages/semaine, soit ≈ {_fmt(impressions)} impressions sur {dur_txt}"
    if enseigne and dist:
        audience += (
            f" ; toutes les faces sont à moins de {dist.get('max_m')} m d'un magasin {enseigne} "
            f"(distance moyenne {dist.get('avg_m')} m)"
        )
    if isinstance(budget, (int, float)) and budget > 0:
        audience += f". Budget estimé : {_fmt(budget)} €"
    parts.append(audience + ".")
    if extra_note:
        parts.append(extra_note)
    parts.append(
        "Dites-moi si vous souhaitez ajuster : rayon autour des magasins, arrondissement, "
        "segment d'audience ou nombre de faces — j'affine le dispositif."
    )
    return " ".join(parts)


def _norm_val(v: Any) -> Any:
    if isinstance(v, dict):
        return tuple(sorted((str(k).strip().lower(), int(val)) for k, val in v.items()))
    if isinstance(v, list):
        return tuple(sorted(str(x).strip().lower() for x in v))
    if isinstance(v, str):
        return v.strip().lower()
    return v


def criteria_changed(
    prior: dict[str, Any] | None, current: dict[str, Any]
) -> bool:
    """Le plan doit-il être régénéré ? Oui au 1er tour ou si un critère change."""
    if not prior:
        return True
    for key in PLAN_KEYS:
        if _norm_val(prior.get(key)) != _norm_val(current.get(key)):
            return True
    return False


def _plan_stats(recommendation: dict[str, Any] | None) -> dict[str, Any] | None:
    if not recommendation:
        return None
    results = recommendation.get("results") or []
    if not results:
        return {"n": 0}
    cities = sorted({str(r.get("city")) for r in results if r.get("city")})
    par_ville = dict(Counter(str(r.get("city")) for r in results if r.get("city")))
    poi_counts = Counter(str(r.get("poi_nearby")) for r in results if r.get("poi_nearby"))
    top_poi = poi_counts.most_common(1)[0][0] if poi_counts else None
    arrs = sorted({int(r["arrondissement"]) for r in results if r.get("arrondissement")})
    sample = []
    for r in results[:4]:
        item: dict[str, Any] = {
            "ville": r.get("city"),
            "adresse": r.get("address"),
            "passages_semaine": r.get("daily_traffic"),
            "impressions": r.get("impressions"),
        }
        if r.get("arrondissement"):
            item["arrondissement"] = r.get("arrondissement")
        if r.get("distance_m") is not None:
            item["distance_magasin_m"] = r.get("distance_m")
            item["magasin_le_plus_proche"] = r.get("nearest_store")
        sample.append(item)
    stats: dict[str, Any] = {
        "faces": len(results),
        "agglomerations": cities,
        "faces_par_ville": par_ville,
        "audience_passages_semaine": recommendation.get("estimated_weekly_reach"),
        "impressions_estimees": recommendation.get("estimated_impressions"),
        "duree_semaines": recommendation.get("duration_weeks"),
        "budget_estime_eur": recommendation.get("estimated_budget"),
        "poi_dominant": top_poi,
        "exemples_faces": sample,
    }
    if arrs:
        stats["arrondissements"] = arrs
    if recommendation.get("distance_stats"):
        stats["distance_aux_magasins_m"] = recommendation["distance_stats"]
        stats["rayon_applique_m"] = recommendation.get("radius_m")
        stats["nb_magasins_consideres"] = len(recommendation.get("stores") or [])
    return stats


_REPLY_SYSTEM = (
    "Tu es l'assistant planner média DOOH de JCDecaux (Retail Media / affichage digital), "
    "un vrai copilote IA conversationnel — pas un robot qui répète toujours la même phrase. "
    "Tu discutes en français, naturellement, comme le ferait ChatGPT ou Claude dans une vraie "
    "conversation : réponses vivantes, formulées différemment à chaque fois. "
    "INTERDIT : reprendre la même structure ou les mêmes tournures que "
    "'derniers_messages_assistant' dans le CONTEXTE, même si le sujet est proche (même ville, "
    "même type de plan…). Change l'angle, l'ordre des informations, la longueur. "
    "RÈGLE ABSOLUE : n'invente jamais de chiffres — utilise uniquement ceux du CONTEXTE. "
    "Tu t'adresses à un CLIENT annonceur (vouvoiement). Ce qui l'intéresse : l'AUDIENCE "
    "(passages/SEMAINE — la base est hebdomadaire —, impressions sur la durée en semaines), le BUDGET "
    "estimé, la DISTANCE des faces aux magasins de son enseigne, l'arrondissement / la zone, et le nombre "
    "de faces. Ne cite jamais le format/type de support (2m2, écran…) : dis « ce panneau »/« cette face ». "
    "INTERDIT : parler de « score », « smart score », « scoring » ou de note interne — ça ne veut "
    "rien dire pour le client. Traduis toujours en bénéfice concret (audience, proximité, visibilité). "
    "Si 'plan_mis_a_jour' est vrai : dis ce qui a changé (voir 'changements' si présent) et donne "
    "un aperçu utile du dispositif (zone, nombre de faces, audience/impressions, distance aux magasins "
    "si enseigne) — choisis toi-même comment le dire, sans formule figée. N'ajoute une piste "
    "d'amélioration que si elle est vraiment spécifique à CE dispositif (jamais la même suggestion "
    "générique répétée à chaque tour). "
    "Si 'plan_mis_a_jour' est faux : réponds UNIQUEMENT à ce que demande le client, sans reparler "
    "du dispositif si ce n'est pas nécessaire. "
    "2 à 5 phrases, jamais de listes à puces, jamais de JSON — seulement ta réponse au client."
)

# Consignes de style tournantes : forcent une vraie variété d'un tour à l'autre,
# sans dépendre uniquement de la température du modèle.
_REPLY_STYLE_HINTS = (
    "Commence directement par le chiffre le plus parlant (nombre de faces, impressions ou distance moyenne), pas par une formule d'intro.",
    "Commence par ce qui a changé dans la demande du client, avant de reparler du plan.",
    "Sois bref et direct, 2 phrases maximum, ton décontracté comme un collègue qui répond vite.",
    "Commence par répondre à l'intention du client, donne les chiffres seulement en 2e partie.",
    "Adopte un ton un peu plus enthousiaste sur ce plan, sans exagérer ni inventer de superlatifs.",
    "Pose éventuellement une question courte au client pour l'aider à préciser la suite, si pertinent.",
)


def generate_llm_reply(
    history: list[dict[str, Any]],
    message: str,
    criteria: dict[str, Any],
    recommendation: dict[str, Any] | None,
    prior_criteria: dict[str, Any] | None = None,
    plan_changed: bool = True,
) -> str | None:
    """Réponse conversationnelle générée par le LLM Groq. None si LLM indisponible."""
    settings = get_settings()
    if not settings.llm_enabled():
        return None
    try:
        llm = get_chat_llm(settings, task=GroqTask.REASONING_FINAL, temperature=0.75)
    except Exception:
        return None

    turns: list[str] = []
    prior_assistant_replies: list[str] = []
    for turn in (history or [])[-6:]:
        role = "Client" if (turn.get("role") == "user") else "Assistant"
        content = (turn.get("content") or "").strip()
        if content:
            turns.append(f"{role}: {content}")
            if role == "Assistant":
                prior_assistant_replies.append(content)
    turns.append(f"Client: {message.strip()}")
    conversation = "\n".join(turns)

    user_turn_count = sum(1 for t in (history or []) if (t.get("role") == "user"))
    style_hint = _REPLY_STYLE_HINTS[user_turn_count % len(_REPLY_STYLE_HINTS)]

    context: dict[str, Any] = {
        "criteres_actuels": {k: criteria.get(k) for k in PLAN_KEYS if criteria.get(k) is not None},
        "plan_mis_a_jour": bool(plan_changed),
    }
    if prior_assistant_replies:
        context["derniers_messages_assistant_a_ne_pas_reformuler_pareil"] = prior_assistant_replies[-2:]
    if plan_changed and prior_criteria:
        diff = _criteria_diff(prior_criteria, criteria)
        if diff:
            context["changements"] = diff
    stats = _plan_stats(recommendation)
    if stats:
        context["plan"] = stats

    prompt = (
        f"{_REPLY_SYSTEM}\n\n"
        f"CONSIGNE DE STYLE POUR CETTE RÉPONSE : {style_hint}\n\n"
        f"CONVERSATION:\n{conversation}\n\n"
        f"CONTEXTE (JSON):\n{json.dumps(context, ensure_ascii=False)}\n\n"
        "Ta réponse au client :"
    )
    try:
        resp = invoke_with_retry(
            llm, prompt, max_retries=2, min_interval_s=1.5, base_delay_s=4.0
        )
    except Exception:
        return None
    if resp is None:
        return None
    text = (getattr(resp, "content", None) or str(resp)).strip()
    return text or None


def handle_chat(
    message: str,
    history: list[dict[str, Any]] | None = None,
    prior_criteria: dict[str, Any] | None = None,
):
    settings = get_settings()
    if settings.llm_enabled():
        try:
            return run_agent(message, history=history, prior_criteria=prior_criteria)
        except Exception as exc:
            # Groq/OpenAI unreachable (réseau, SSL entreprise, clé invalide) → fallback explicite
            err = type(exc).__name__
            hint = (
                "Clé Groq détectée mais appel LLM échoué "
                f"({err}). Ajoutez GROQ_INSECURE_SKIP_SSL_VERIFY=1 dans votre .env "
                "(déjà activé dans docker-compose), redémarrez, ou lancez le backend hors Docker."
            )
            criteria = _merge_followup_criteria(message, prior_criteria)
            recommendation = recommend_panels(criteria)
            return {
                "assistant_message": build_assistant_reply(
                    criteria, recommendation, prior_criteria=prior_criteria, extra_note=hint
                ),
                "extracted_criteria": criteria,
                "recommendation": recommendation,
                "meta": {
                    "llm_used": False,
                    "llm_provider": "groq" if settings.groq_api_key else None,
                    "brief_source": "heuristic_fallback",
                    "recommendation_source": "scoring_engine",
                    "explanation_source": "template_rules",
                    "panel_copy_llm": False,
                    "llm_ssl_verify": not settings.llm_skip_ssl_verify,
                    "llm_tls_mode": "verified" if not settings.llm_skip_ssl_verify else "docker_network",
                    "error": err,
                },
            }

    criteria = _merge_followup_criteria(message, prior_criteria)
    recommendation = recommend_panels(criteria)
    mismatch = get_openai_env_mismatch_hint()
    note = (
        mismatch
        if mismatch
        else "Mode sans clé LLM : plan basé sur le scoring métier (les textes sont générés par règles)."
    )
    return {
        "assistant_message": build_assistant_reply(
            criteria, recommendation, prior_criteria=prior_criteria, extra_note=note
        ),
        "extracted_criteria": criteria,
        "recommendation": recommendation,
        "meta": {
            "llm_used": False,
            "llm_provider": None,
            "brief_source": "heuristic_fallback",
            "recommendation_source": "scoring_engine",
            "explanation_source": "template_rules",
            "panel_copy_llm": False,
            "llm_ssl_verify": not get_settings().llm_skip_ssl_verify,
            "llm_tls_mode": (
                "verified"
                if not get_settings().llm_skip_ssl_verify
                else "docker_network"
            ),
        },
    }
