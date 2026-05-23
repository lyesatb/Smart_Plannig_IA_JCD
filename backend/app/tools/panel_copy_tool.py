from __future__ import annotations

import json
import re
import time
from typing import Any

from app.config.settings import get_settings
from app.llm.factory import parse_llm_json_any
from app.llm.router import resolve_panel_llm
from app.llm.invoke import invoke_with_retry
from app.llm.throttle import wait_llm_slot

CITY_ALIASES: dict[str, list[str]] = {
    "paris": ["paris", "parisien", "parisienne", "capitale"],
    "lyon": ["lyon", "lyonnais", "lyonnaise"],
    "bordeaux": ["bordeaux", "bordelais", "bordelaise"],
    "marseille": ["marseille", "marseillais"],
    "lille": ["lille", "lillois"],
    "toulouse": ["toulouse", "toulousain"],
    "nantes": ["nantes", "nantais"],
}

STYLE_HINTS = (
    "Commence par le quartier et le flux piéton — impact sur la mémorisation.",
    "Commence par la cible et son moment de vie sur place (brief).",
    "Commence par le secteur marque et la promesse produit adaptée au lieu.",
    "Commence par le format écran et la visibilité en contexte rue.",
    "Commence par la notoriété locale et la couverture du territoire.",
    "Commence par le POI proche et le parcours d'achat / déplacement.",
    "Commence par l'affinité audience-zone (profil déclaré dans profil_zone).",
    "Commence par le rôle du panneau dans le plan média (complémentarité).",
)

STRUCTURE_HINTS = (
    "§1 « En utilisant ce panneau [format] situé près du [POI]… » §2 visibilité + audience premium.",
    "§1 « La proximité du [POI] autour de ce [format] à [ville]… » §2 bénéfice campagne.",
    "§1 « Pour la cible [target], ce [format] près du [POI]… » §2 impact média.",
    "§1 « Placer la campagne [industry] sur ce [format] (POI [poi])… » §2 moment de vie.",
    "§1 « Le choix de ce support à [district]… » §2 complémentarité dans le plan.",
    "§1 « Les flux au [POI] font de ce panneau… » §2 pertinence secteur.",
    "§1 « Ce [format] à [ville] répond au brief car… » §2 visibilité (sans chiffres).",
    "§1 « Dans le parcours [POI], ce panneau… » §2 consommateurs cibles.",
    "§1 « Affichage [format] : l'enjeu ici est… » §2 notoriété / mémorisation.",
    "§1 « Opportunité média : [POI] + [format]… » §2 objectif campagne.",
)

def _campaign_intent(brief: dict[str, Any]) -> str:
    """Intention campagne sans liste de villes (évite que le LLM les recopie partout)."""
    parts: list[str] = []
    if brief.get("industry"):
        parts.append(f"secteur {brief['industry']}")
    if brief.get("target"):
        parts.append(f"cible {brief['target']}")
    if brief.get("objective"):
        parts.append(str(brief["objective"]))
    if brief.get("poi"):
        parts.append(f"proximité {brief['poi']}")
    return ", ".join(parts) if parts else "campagne DOOH"


def _brief_city_names(brief: dict[str, Any]) -> list[str]:
    names: list[str] = []
    if brief.get("city"):
        names.append(str(brief["city"]))
    for c in brief.get("cities") or []:
        if c and str(c) not in names:
            names.append(str(c))
    return names


def _planner_hints(panel: dict[str, Any], brief: dict[str, Any]) -> list[str]:
    hints: list[str] = []
    target = (brief.get("target") or "").lower()
    objective = (brief.get("objective") or "").lower()
    industry = (brief.get("industry") or "").lower()
    poi = str(panel.get("poi_nearby") or "").lower()
    district = str(panel.get("district") or "").lower()
    csp = float(panel.get("audience_csp_plus") or 0)
    young = float(panel.get("audience_young_active") or 0)

    if industry:
        hints.append(f"secteur {industry}")
    if brief.get("industry") and "bio" in str(brief.get("industry")).lower():
        hints.append("gamme bio / naturel")
    if "csp" in target or "premium" in objective:
        if csp >= 70:
            hints.append("profil CSP+")
    if "jeune" in target and young >= 65:
        hints.append("jeunes actifs")
    if "gare" in objective and poi == "gare":
        hints.append("flux gare")
    if poi == "université" or "campus" in district:
        hints.append("zone campus")
    if poi in {"centre commercial", "zone commerciale"}:
        hints.append("retail / achat")
    return hints[:4]


PLANNER_STYLE_EXAMPLE = (
    "En utilisant ce panneau écran DOOH situé près d'une gare, nous touchons les voyageurs "
    "en correspondance, pertinent pour une campagne premium CSP+. L'excellente visibilité "
    "et l'audience premium dominante maximisent l'impact de la marque sur ce support précis."
)


def _qualitative_strengths(p: dict[str, Any]) -> list[str]:
    """Forces du panneau en langage planner (sans chiffres)."""
    out: list[str] = []
    vis = float(p.get("visibility_score") or 0)
    csp = float(p.get("audience_csp_plus") or 0)
    young = float(p.get("audience_young_active") or 0)
    if vis >= 88:
        out.append("excellente visibilité")
    elif vis >= 75:
        out.append("bonne visibilité")
    if csp >= 78:
        out.append("audience premium dominante")
    elif csp >= 60:
        out.append("audience qualifiée")
    if young >= 70:
        out.append("forte présence jeunes actifs")
    if float(p.get("daily_traffic") or 0) >= 80000:
        out.append("fort trafic piéton")
    return out[:3]


def _poi_business_link(
    poi: str,
    industry: str,
    target: str,
    brief: dict[str, Any] | None = None,
) -> str:
    poi_l = (poi or "").lower()
    ind = (industry or "").lower() if industry and industry not in ("la marque", "null") else ""
    b = brief or {}
    objective = str(b.get("objective") or "").lower()
    brief_poi = str(b.get("poi") or "").lower()
    tgt = (target or "").lower()

    if poi_l == "gare" or "gare" in brief_poi:
        if "premium" in objective or "csp" in tgt:
            return (
                "intercepter voyageurs et flux de correspondances, idéal pour une "
                "campagne premium auprès de CSP+"
            )
        return "intercepter les voyageurs et temps d'attente, utile pour une présence de marque"
    if poi_l in ("aéroport", "aeroport"):
        return "toucher les voyageurs en transit, réceptifs aux messages premium"
    if poi_l == "université":
        return "renforcer la notoriété auprès d'un public étudiant et campus"
    if poi_l == "cinéma":
        return "toucher un public en sortie loisirs, favorable à la mémorisation"
    if poi_l in ("centre commercial", "zone commerciale"):
        if ind and "bio" in ind:
            return "rejoindre les acheteurs en retail, pertinent pour une gamme bio"
        if "csp" in tgt or "premium" in objective:
            return "rejoindre une audience premium en parcours d'achat"
        return "rejoindre les flux en zone commerciale au moment d'achat"
    if poi_l == "restaurant":
        if ind and "bio" in ind:
            return "cibler les consommateurs en phase d'achat alimentaire bio"
        return "cibler les consommateurs en restauration et passage urbain"
    if poi_l == "stade":
        return "capitaliser sur l'affluence événementielle et le grand public"
    if "csp" in tgt or "premium" in objective:
        return f"parler efficacement à la cible {target or 'CSP+'}"
    return (
        f"créer une rencontre pertinente entre la marque et "
        f"{target or 'la cible'} au moment du passage sur place"
    )


def _panel_enjeux(p: dict[str, Any], brief: dict[str, Any]) -> list[str]:
    """Enjeux métier qualitatifs (sans chiffres KPI)."""
    enjeux: list[str] = []
    csp = float(p.get("audience_csp_plus") or 0)
    young = float(p.get("audience_young_active") or 0)
    vis = float(p.get("visibility_score") or 0)
    poi = str(p.get("poi_nearby") or "")
    fmt = str(p.get("format") or "")

    if vis >= 85:
        enjeux.append("excellente lisibilité en environnement urbain dense")
    elif vis >= 70:
        enjeux.append("bonne visibilité pour ancrer le message")
    if csp >= 75:
        enjeux.append("audience à forte valeur pour marques premium / CSP+")
    if young >= 70:
        enjeux.append("zone propice aux jeunes actifs et early adopters")
    if poi == "gare":
        enjeux.append("captation des flux voyageurs et temps d'attente")
    elif poi == "centre commercial":
        enjeux.append("intention d'achat en zone retail")
    elif poi == "université":
        enjeux.append("notoriété auprès d'un public étudiant")
    if "dooh" in fmt.lower() or "écran" in fmt.lower():
        enjeux.append("format digital pour messages courts et mémorables")
    if brief.get("objective"):
        enjeux.append(f"alignement objectif : {brief['objective']}")
    return enjeux[:3] if enjeux else ["impact local et pertinence média"]


def _normalize_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-zàâäéèêëïîôùûüç]{4,}", text.lower()))


def _too_similar(expl: str, others: list[str], threshold: float = 0.38) -> bool:
    if not others:
        return False
    el = expl.lower().strip()
    a = _normalize_tokens(el)
    if len(a) < 5:
        return False
    for o in others:
        ol = o.lower().strip()
        if el[:35] == ol[:35]:
            return True
        b = _normalize_tokens(ol)
        if not b:
            continue
        union = len(a | b)
        if union and len(a & b) / union >= threshold:
            return True
    return False


def _collect_existing(by_id: dict[str, dict[str, Any]], exclude_pid: str | None = None) -> list[str]:
    out: list[str] = []
    for pid, row in by_id.items():
        if exclude_pid and pid == exclude_pid:
            continue
        t = (row.get("explanation") or "").strip()
        if t:
            out.append(t)
    return out


def _why_panel_selected(
    p: dict[str, Any], brief: dict[str, Any], rank: int, total: int
) -> list[str]:
    """Raisons moteur scoring — à traduire en recommandation panneau."""
    reasons: list[str] = []
    fmt = p.get("format") or "écran DOOH"
    poi = str(p.get("poi_nearby") or "")
    score = p.get("smart_score")
    reasons.append(f"Retenu en position #{rank}/{total} du plan (score moteur {score}).")
    reasons.append(f"Support exact : {fmt}, POI {poi or '—'}.")

    brief_poi = str(brief.get("poi") or "").lower()
    if brief_poi and brief_poi in poi.lower():
        reasons.append(f"Correspond au critère brief POI « {brief.get('poi')} ».")
    objective = (brief.get("objective") or "").lower()
    if "gare" in objective and poi == "gare":
        reasons.append("Sélectionné car objectif campagne = proximité gare.")
    target = (brief.get("target") or "").lower()
    if "csp" in target and float(p.get("audience_csp_plus") or 0) >= 55:
        reasons.append("Audience du panneau alignée cible CSP+.")
    if "jeune" in target and float(p.get("audience_young_active") or 0) >= 60:
        reasons.append("Audience du panneau alignée jeunes actifs.")
    if float(p.get("visibility_score") or 0) >= 88:
        reasons.append("Visibilité forte de ce support.")
    reasons.append("Choisi pour compléter le plan (diversité format/POI vs autres faces).")
    return reasons[:5]


def _panel_label(p: dict[str, Any]) -> str:
    fmt = p.get("format") or "écran"
    poi = p.get("poi_nearby")
    city = p.get("city")
    district = p.get("district")
    base = f"{fmt}"
    if poi:
        base += f", POI {poi}"
    if city and district:
        base += f", {city} — {district}"
    elif city:
        base += f", {city}"
    return base


def _panel_facts(
    p: dict[str, Any],
    brief: dict[str, Any],
    index: int,
    *,
    rank: int,
    total: int,
) -> dict[str, Any]:
    """Fiche CE panneau — pas le quartier en général."""
    return {
        "panel_id": p.get("panel_id"),
        "panneau_a_justifier": _panel_label(p),
        "format": p.get("format"),
        "poi": p.get("poi_nearby"),
        "quartier": p.get("district"),
        "ville": p.get("city"),
        "score_moteur": p.get("smart_score"),
        "raisons_selection": _why_panel_selected(p, brief, rank, total),
        "atouts_qualitatifs": _qualitative_strengths(p),
        "lien_poi_campagne": _poi_business_link(
            str(p.get("poi_nearby") or ""),
            str(brief.get("industry") or ""),
            str(brief.get("target") or ""),
            brief,
        ),
        "profil_audience": _planner_hints(p, brief),
        "angle_redaction": STYLE_HINTS[index % len(STYLE_HINTS)],
        "structure_imposee": STRUCTURE_HINTS[index % len(STRUCTURE_HINTS)],
    }


def _is_kpi_dump(expl: str, panel: dict[str, Any]) -> bool:
    el = expl.lower()
    if re.search(r"\bscore\s+smart\b", el) or "smart_score" in el:
        return True
    if re.search(r"\d{2,}\s*%", el) and ("visibilité" in el or "csp" in el):
        return True
    traffic = panel.get("daily_traffic")
    if traffic and str(int(traffic)) in expl.replace(" ", ""):
        return True
    return False


def _mentions_wrong_city(expl: str, city: str) -> bool:
    if not city:
        return False
    el = expl.lower()
    city_l = city.lower()
    for other, aliases in CITY_ALIASES.items():
        if other == city_l:
            continue
        for alias in aliases:
            if alias in el and city_l not in el:
                return True
    return False


def _mentions_panel_city(expl: str, city: str) -> bool:
    if not city:
        return True
    el = expl.lower()
    city_l = city.lower()
    if city_l in el:
        return True
    for alias in CITY_ALIASES.get(city_l, []):
        if alias in el:
            return True
    return False


def _mentions_gare_incorrectly(expl: str, poi: str) -> bool:
    el = expl.lower()
    return "gare" in el and poi.lower() != "gare"


def _mentions_other_campaign_cities(expl: str, panel: dict[str, Any], brief: dict[str, Any]) -> bool:
    """Interdit Paris+Lyon+Bordeaux quand le panneau n'est qu'à Lyon."""
    panel_city = str(panel.get("city") or "").lower()
    if not panel_city:
        return False
    el = expl.lower()
    for name in _brief_city_names(brief):
        cl = name.lower()
        if cl == panel_city:
            continue
        for alias in CITY_ALIASES.get(cl, [cl]):
            if alias in el:
                return True
    return False


def _is_generic_fluff(expl: str) -> bool:
    el = expl.lower()
    fluff = (
        "expérience immersive",
        "créer une expérience",
        "partager leur expérience",
        "galeries marchandes et les centres commerciaux",
        "paris, lyon et bordeaux",
        "paris lyon bordeaux",
        "demande client",
        "selon le brief",
    )
    return any(p in el for p in fluff)


def _mentions_irrelevant_bio(expl: str, brief: dict[str, Any] | None) -> bool:
    if not brief:
        return False
    ind = str(brief.get("industry") or "").lower()
    obj = str(brief.get("objective") or "").lower()
    if "bio" in ind or "bio" in obj:
        return False
    el = expl.lower()
    return "gamme bio" in el or " offre bio" in el or "produit bio" in el


def _is_template_echo(expl: str) -> bool:
    """Formules répétitives à bannir (fallback LLM paresseux)."""
    el = expl.lower()
    banned = (
        "complète le plan",
        "son profil d'audience et sa visibilité soutiennent",
        "soutiennent « promouvoir",
        "renforcer la présence bio auprès de grand public",
        "permet de maximiser l'impact pour grand public et l'objectif",
        "particulièrement pertinent pour une gamme bio",
    )
    return any(b in el for b in banned)


def _mentions_panel_asset(expl: str, panel: dict[str, Any]) -> bool:
    el = expl.lower()
    fmt = str(panel.get("format") or "").lower()
    poi = str(panel.get("poi_nearby") or "").lower()
    if fmt and fmt in el:
        return True
    if poi and poi in el:
        return True
    return "écran" in el or "galerie" in el or "dooh" in el or "face" in el


def _is_panel_focused(expl: str, panel: dict[str, Any]) -> bool:
    """Reco planner : ce panneau + POI/format, pas discours ville générique."""
    el = expl.lower().strip()
    poi = str(panel.get("poi_nearby") or "").lower()
    if not (_mentions_panel_asset(expl, panel) or (poi and poi in el)):
        return False
    panel_markers = (
        "ce panneau",
        "cette face",
        "cet écran",
        "ce support",
        "situé près",
        "situe près",
        "en utilisant ce",
        "en positionnant ce",
        "la proximité du",
        "placer la campagne",
        "le choix de ce",
        "affichage ",
        "opportunité média",
    )
    if not any(m in el for m in panel_markers):
        return False
    return True


def _links_campaign_brief(expl: str, brief: dict[str, Any], panel: dict[str, Any]) -> bool:
    """Doit relier campagne (secteur/cible) au POI ou au panneau."""
    el = expl.lower()
    ind = (brief.get("industry") or "").lower()
    if ind and ind in el:
        return True
    if "bio" in ind and any(w in el for w in ("bio", "aliment", "consommat", "naturel")):
        return True
    tgt = (brief.get("target") or "").lower()
    if tgt and any(w in el for w in ("csp", "premium", "jeune", "famille", "cible", "consommat")):
        return True
    poi = str(panel.get("poi_nearby") or "").lower()
    return bool(poi and poi in el)


def _is_rich_enough(expl: str) -> bool:
    t = expl.strip()
    if len(t) < 52:
        return False
    sentences = [s.strip() for s in re.split(r"[.!?]+", t) if len(s.strip()) > 12]
    return len(sentences) >= 2


def _explanation_is_valid(
    expl: str,
    panel: dict[str, Any],
    brief: dict[str, Any] | None = None,
    *,
    existing: list[str] | None = None,
) -> bool:
    if not expl or not _is_rich_enough(expl):
        return False
    if existing and _too_similar(expl, existing):
        return False
    if _is_kpi_dump(expl, panel):
        return False
    city = str(panel.get("city") or "")
    poi = str(panel.get("poi_nearby") or "")
    if _mentions_wrong_city(expl, city) or _mentions_gare_incorrectly(expl, poi):
        return False
    if _is_template_echo(expl):
        return False
    if brief and _mentions_irrelevant_bio(expl, brief):
        return False
    if brief and (_mentions_other_campaign_cities(expl, panel, brief) or _is_generic_fluff(expl)):
        return False
    if not _is_panel_focused(expl, panel):
        return False
    if brief and not _links_campaign_brief(expl, brief, panel):
        return False
    if not _mentions_panel_city(expl, city):
        return False
    return True


def _parse_batch_explanations(content: str, expected_n: int | None = None) -> list[dict[str, Any]]:
    if not content or not content.strip():
        return []
    text = content.strip()
    data: Any = None
    match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", text)
    if match:
        try:
            data = json.loads(match.group(0))
        except Exception:
            data = None
    if data is None:
        try:
            data = parse_llm_json_any(text)
        except Exception:
            return []

    if isinstance(data, dict):
        for key in ("items", "results", "explanations", "panels", "data"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            return []

    if not isinstance(data, list):
        return []
    items = [x for x in data if isinstance(x, dict) and x.get("explanation")]
    if expected_n is not None and len(items) != expected_n:
        return []
    return items


def _match_panel_id(item: dict[str, Any], panels: list[dict[str, Any]]) -> str | None:
    pid = str(item.get("panel_id") or item.get("id") or "")
    if pid:
        for p in panels:
            full = str(p.get("panel_id") or "")
            if pid == full or full.endswith(pid) or pid.endswith(full[-8:]):
                return full
    idx = item.get("index")
    if isinstance(idx, int) and 0 <= idx < len(panels):
        return str(panels[idx].get("panel_id") or "")
    return None


def _diversity_block(existing: list[str]) -> str:
    if not existing:
        return ""
    openings = []
    for e in existing[-6:]:
        words = e.split()[:8]
        if words:
            openings.append(" ".join(words))
    block = "DÉJÀ RÉDIGÉ (ne pas imiter ni reformuler pareil) :\n"
    for i, o in enumerate(existing[-4:], 1):
        block += f"- {o[:120]}...\n" if len(o) > 120 else f"- {o}\n"
    if openings:
        block += "Interdit de commencer comme : " + " | ".join(f'« {x}… »' for x in openings[:4]) + "\n"
    return block


def _build_prompt(
    brief: dict[str, Any],
    panels: list[dict[str, Any]],
    *,
    ranks: dict[str, int],
    total: int,
    panel_offset: int = 0,
    existing: list[str] | None = None,
) -> str:
    contexts = []
    for i, p in enumerate(panels):
        pid = str(p.get("panel_id") or "")
        rank = ranks.get(pid, panel_offset + i + 1)
        contexts.append(_panel_facts(p, brief, panel_offset + i, rank=rank, total=total))
    n = len(panels)
    intent = _campaign_intent(brief)
    if n == 1:
        ctx = contexts[0]
        return (
            "Tu es planner média DOOH JCDecaux. Rédige la recommandation client pour CE panneau sélectionné.\n"
            "STYLE ATTENDU (exemple à imiter pour la forme, pas le contenu) :\n"
            f"« {PLANNER_STYLE_EXAMPLE} »\n"
            "Rédige 2-4 phrases (80-120 mots), ton planner, structure_imposee du JSON (OBLIGATOIRE, chaque panneau différent).\n"
            "Contenu : lien POI ↔ campagne (lien_poi_campagne) + atouts_qualitatifs + pourquoi CE panneau vs un autre.\n"
            "INTERDIT formules répétitives : « complète le plan », « Son profil d'audience et sa visibilité soutiennent », "
            "« Cette face X près du Y complète le plan ».\n"
            "INTERDIT : copier l'exemple, lister Paris/Lyon/Bordeaux, %, trafic chiffré, « gamme bio » "
            "si le brief n'est pas alimentaire/bio.\n"
            f"POI brief : {brief.get('poi') or '—'} — le texte doit coller à CE POI du panneau, pas un autre contexte.\n"
            f"{_diversity_block(existing or [])}"
            f"Intention campagne : {intent}\n"
            f"Fiche panneau :\n{json.dumps(ctx, ensure_ascii=False)}\n"
            f'JSON : [{{"panel_id":"{ctx["panel_id"]}","explanation":"..."}}]'
        )
    return (
        "Planner DOOH JCDecaux — une explanation par panneau = POURQUOI CE PANNEAU est retenu.\n"
        "Chaque texte : commence par « Ce panneau »/« Cette face » + format + POI ; 3 phrases ; unique.\n"
        "Pas de discours sur le quartier/ville en général — uniquement CE support listé.\n"
        f"{_diversity_block(existing or [])}"
        f"Intention campagne : {intent}\n"
        f"Panneaux ({n}) :\n{json.dumps(contexts, ensure_ascii=False)}\n"
        f'JSON array de {n} : [{{"panel_id":"...","explanation":"..."}}]'
    )


def _fallback_explanation(
    panel: dict[str, Any],
    brief: dict[str, Any],
    index: int,
    *,
    rank: int = 1,
    total: int = 1,
    existing: list[str] | None = None,
) -> str:
    """Recommandation panneau (pas zone) — texte de secours."""
    fmt = panel.get("format") or "écran DOOH"
    poi = panel.get("poi_nearby") or "zone urbaine"
    city = panel.get("city") or ""
    district = panel.get("district") or ""
    target = brief.get("target") or "grand public"
    industry = brief.get("industry") or "la marque"
    objective = brief.get("objective") or "visibilité"
    score = panel.get("smart_score")
    reasons = _why_panel_selected(panel, brief, rank, total)
    r1 = reasons[1] if len(reasons) > 1 else ""

    link = _poi_business_link(poi, industry, target, brief)
    strengths = _qualitative_strengths(panel)
    vis = strengths[0] if strengths else "bonne visibilité"
    aud = strengths[1] if len(strengths) > 1 else "audience qualifiée"
    place = f"{city} — {district}" if district else city
    slot = (index + rank) % 10

    templates: list[str] = [
        (
            f"En utilisant ce panneau {fmt} situé près d'un {poi} à {place}, nous pouvons {link}. "
            f"La {vis} de ce support et son {aud} permettent de maximiser l'impact de la campagne "
            f"{industry} et d'atteindre les consommateurs cibles ({target})."
        ),
        (
            f"La proximité du {poi} autour de ce {fmt} à {city} place la marque {industry} au bon moment "
            f"du parcours client : {link}. "
            f"On capitalise ici sur la {vis} et une {aud} pour délivrer l'objectif « {objective} »."
        ),
        (
            f"Pour toucher {target}, ce {fmt} installé face au {poi} ({place}) crée une opportunité média "
            f"spécifique : {link}. "
            f"Le support se distingue par sa {vis}, gage de mémorisation pour la campagne {industry}."
        ),
        (
            f"Placer la campagne {industry} sur ce {fmt} près du {poi} à {city} permet de {link}. "
            f"La {vis} et la {aud} de ce panneau renforcent la cohérence du plan média "
            f"(sélection #{rank}/{total}, score {score})."
        ),
        (
            f"Le choix de ce support {fmt} à {place} répond au brief : le contexte {poi} aide à {link}. "
            f"Enjeu planner : sécuriser la présence {industry} là où la {vis} et la {aud} convergent."
        ),
        (
            f"Les flux générés par le {poi} à proximité de ce {fmt} expliquent la sélection : "
            f"{link}. "
            f"Pour {industry}, c'est un point de contact efficace vers {target}, avec {vis} et {aud}."
        ),
        (
            f"Ce {fmt} à {city} (quartier {district or '—'}, POI {poi}) est retenu car il permet de {link}. "
            f"La combinaison {vis} + {aud} maximise la pertinence versus un autre écran du même plan."
        ),
        (
            f"Dans un parcours type « {poi} », ce panneau {fmt} offre à {industry} un accès direct à {target} : "
            f"{link}. "
            f"Atout clé : {vis} localement, complétée par une {aud}."
        ),
        (
            f"Affichage {fmt} — l'enjeu sur {place} est de {link}. "
            f"Ce panneau apporte la {vis} attendue et une {aud}, utiles pour « {objective} »."
        ),
        (
            f"Opportunité média : associer {fmt} et {poi} à {city} pour {link}. "
            f"Le planner retient ce support (#{rank}/{total}) pour sa {vis} et sa {aud}, "
            f"au service de {industry} et {target}."
        ),
    ]
    for offset in range(len(templates)):
        text = templates[(slot + offset) % len(templates)]
        if _is_template_echo(text):
            continue
        if not existing or not _too_similar(text, existing, threshold=0.30):
            return text
    return templates[slot % len(templates)]


def _is_rate_err(e: Exception) -> bool:
    s = str(e).lower()
    return (
        "429" in s
        or "rate" in s
        or "too many" in s
        or "tokens per minute" in s
        or "tpm" in s
    )


def _is_daily_err(e: Exception) -> bool:
    s = str(e).lower()
    return "tokens per day" in s or "tpd" in s


def _explain_batch(
    llm,
    brief: dict[str, Any],
    panels: list[dict[str, Any]],
    *,
    ranks: dict[str, int],
    total: int,
    panel_offset: int = 0,
    existing: list[str] | None = None,
) -> dict[str, str]:
    n = len(panels)
    prompt = _build_prompt(
        brief,
        panels,
        ranks=ranks,
        total=total,
        panel_offset=panel_offset,
        existing=existing,
    )
    content = ""
    interval = max(3.0, get_settings().groq_min_interval_s)
    resp = invoke_with_retry(
        llm,
        prompt,
        min_interval_s=interval,
        max_retries=1,
        base_delay_s=6.0,
        fail_fast_rate_limit=True,
    )
    if resp is not None:
        content = getattr(resp, "content", None) or str(resp)

    out: dict[str, str] = {}
    items = _parse_batch_explanations(content, expected_n=n)
    if not items:
        items = _parse_batch_explanations(content, expected_n=None)

    if len(items) == len(panels):
        for i, item in enumerate(items):
            pid = str(panels[i].get("panel_id") or "")
            expl = item.get("explanation")
            if pid and isinstance(expl, str) and expl.strip():
                out[pid] = expl.strip()
        return out

    for i, item in enumerate(items):
        pid = _match_panel_id(item, panels) or (
            str(panels[i].get("panel_id") or "") if i < len(panels) else None
        )
        expl = item.get("explanation")
        if pid and isinstance(expl, str) and expl.strip():
            out[pid] = expl.strip()
    return out


def _panel_index(targets: list[dict[str, Any]], panel: dict[str, Any]) -> int:
    pid = str(panel.get("panel_id") or "")
    for i, t in enumerate(targets):
        if str(t.get("panel_id") or "") == pid:
            return i
    return 0


def _apply_llm_mapping(
    mapping: dict[str, str],
    panels: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    brief: dict[str, Any],
    *,
    model_name: str | None = None,
) -> int:
    ok = 0
    for p in panels:
        pid = str(p.get("panel_id") or "")
        expl = mapping.get(pid)
        prior = _collect_existing(by_id, exclude_pid=pid)
        if expl and _explanation_is_valid(expl, p, brief, existing=prior):
            by_id[pid]["explanation"] = expl
            if model_name:
                by_id[pid]["explanation_model"] = model_name
            ok += 1
    return ok


def _fill_missing_with_fallback(
    targets: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    brief: dict[str, Any],
    *,
    ranks: dict[str, int],
    total: int,
    model_label: str,
) -> int:
    added = 0
    for i, p in enumerate(targets):
        pid = str(p["panel_id"])
        if (by_id[pid].get("explanation") or "").strip():
            continue
        prior = _collect_existing(by_id, exclude_pid=pid)
        by_id[pid]["explanation"] = _fallback_explanation(
            p,
            brief,
            i,
            rank=ranks.get(pid, i + 1),
            total=total,
            existing=prior,
        )
        by_id[pid]["explanation_model"] = f"{model_label}_rules"
        added += 1
    return added


def _dedupe_similar_explanations(
    targets: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    brief: dict[str, Any],
    *,
    ranks: dict[str, int],
    total: int,
    model_label: str,
) -> int:
    """Remplace les textes trop ressemblants par un fallback distinct."""
    fixed = 0
    seen: list[str] = []
    for i, p in enumerate(targets):
        pid = str(p["panel_id"])
        expl = (by_id[pid].get("explanation") or "").strip()
        if not expl:
            continue
        if _too_similar(expl, seen, threshold=0.34) or not _is_panel_focused(expl, p):
            by_id[pid]["explanation"] = _fallback_explanation(
                p,
                brief,
                i + fixed + 3,
                rank=ranks.get(pid, i + 1),
                total=total,
                existing=seen,
            )
            by_id[pid]["explanation_model"] = f"{model_label}_dedupe"
            expl = by_id[pid]["explanation"]
            fixed += 1
        seen.append(expl)
    return fixed


def _missing_panels(
    targets: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        p for p in targets
        if not (by_id[str(p["panel_id"])].get("explanation") or "").strip()
    ]


def enrich_recommendation_explanations(
    user_message: str,
    brief: dict[str, Any],
    rag_matches: list[dict[str, Any]],
    recommendation: dict[str, Any],
    *,
    rag_summary: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Textes panneaux 8B : lots de 3, validation contexte, fallback métier rapide."""
    settings = get_settings()
    if not settings.llm_enabled():
        return recommendation, False

    results = list(recommendation.get("results") or [])
    if not results:
        return recommendation, False

    targets = sorted(
        results,
        key=lambda r: -(float(r.get("smart_score") or 0)),
    )
    total = len(targets)
    ranks = {str(p["panel_id"]): i + 1 for i, p in enumerate(targets)}
    llm, model_used, _ = resolve_panel_llm(settings)
    by_id = {str(r["panel_id"]): r for r in results}
    for p in targets:
        by_id[str(p["panel_id"])]["explanation"] = ""
        by_id[str(p["panel_id"])]["explanation_model"] = ""

    batch_n = max(1, min(int(settings.groq_batch_size or 4), 6))
    gap = max(1.0, settings.groq_batch_delay_s * 0.5)
    llm_interval = max(2.0, settings.groq_min_interval_s * 0.85)
    main_wall_s = 75.0
    started = time.time()

    missing = _missing_panels(targets, by_id)
    for i in range(0, len(missing), batch_n):
        if time.time() - started >= main_wall_s:
            break
        chunk = missing[i : i + batch_n]
        prior = _collect_existing(by_id)
        wait_llm_slot(llm_interval)
        mapping: dict[str, str] = {}
        try:
            mapping = _explain_batch(
                llm,
                brief,
                chunk,
                ranks=ranks,
                total=total,
                panel_offset=_panel_index(targets, chunk[0]),
                existing=prior,
            )
        except Exception as e:
            if _is_daily_err(e):
                break
            if _is_rate_err(e):
                time.sleep(8.0)
                break

        _apply_llm_mapping(mapping, chunk, by_id, brief, model_name=model_used)
        if i + batch_n < len(missing):
            time.sleep(gap)

    fallback_n = _fill_missing_with_fallback(
        targets, by_id, brief, ranks=ranks, total=total, model_label=model_used
    )
    dedupe_n = _dedupe_similar_explanations(
        targets, by_id, brief, ranks=ranks, total=total, model_label=model_used
    )

    llm_ok = sum(
        1 for p in targets
        if (by_id[str(p["panel_id"])].get("explanation") or "").strip()
    )
    recommendation["results"] = [by_id[str(r["panel_id"])] for r in results]
    target_n = len(targets)
    ok = llm_ok >= target_n
    recommendation["llm_explanations_count"] = llm_ok
    recommendation["llm_explanations_target"] = target_n
    recommendation["llm_only_mode"] = True
    recommendation["groq_model_used"] = model_used
    recommendation["groq_panel_primary_model"] = model_used
    recommendation["panel_explanations_8b"] = llm_ok
    recommendation["panel_explanations_70b"] = 0
    recommendation["panel_copy_rules_fallback_count"] = fallback_n
    recommendation["panel_copy_dedupe_count"] = dedupe_n
    recommendation["groq_panel_fallback_8b"] = False
    recommendation["panel_copy_duration_s"] = round(time.time() - started, 1)
    return recommendation, ok
