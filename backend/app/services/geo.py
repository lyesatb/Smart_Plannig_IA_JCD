"""Géolocalisation : distances, arrondissements de Paris, magasins d'enseignes."""
from __future__ import annotations

import math
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
STORES_PATH = DATA_DIR / "stores.csv"

# Centroïdes approximatifs des 20 arrondissements (données simulées : suffisant pour le MVP).
ARRONDISSEMENT_CENTROIDS: dict[int, tuple[float, float]] = {
    1: (48.8625, 2.3364), 2: (48.8683, 2.3428), 3: (48.8630, 2.3600), 4: (48.8543, 2.3576),
    5: (48.8445, 2.3500), 6: (48.8493, 2.3328), 7: (48.8562, 2.3123), 8: (48.8727, 2.3125),
    9: (48.8770, 2.3374), 10: (48.8761, 2.3606), 11: (48.8590, 2.3800), 12: (48.8351, 2.4215),
    13: (48.8283, 2.3623), 14: (48.8292, 2.3266), 15: (48.8401, 2.2928), 16: (48.8604, 2.2620),
    17: (48.8873, 2.3068), 18: (48.8925, 2.3486), 19: (48.8871, 2.3847), 20: (48.8634, 2.4012),
}

# Au-delà de ~2,2 km d'un centroïde on considère qu'on est hors Paris intra-muros.
_MAX_ARR_DIST_M = 2200.0

ENSEIGNE_ALIASES: dict[str, str] = {
    "nicolas": "Nicolas",
    "maison nicolas": "Nicolas",
    "caves nicolas": "Nicolas",
    "carrefour": "Carrefour City",
    "carrefour city": "Carrefour City",
    "carrefour market": "Carrefour City",
    "monoprix": "Monoprix",
    "monop": "Monoprix",
    "franprix": "Franprix",
    "picard": "Picard",
    "sephora": "Sephora",
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def haversine_matrix_m(
    lat_a: np.ndarray, lon_a: np.ndarray, lat_b: np.ndarray, lon_b: np.ndarray
) -> np.ndarray:
    """Distances (m) entre chaque point de A (n) et chaque point de B (m) → matrice n×m."""
    r = 6371000.0
    la = np.radians(lat_a)[:, None]
    lb = np.radians(lat_b)[None, :]
    dlat = lb - la
    dlon = np.radians(lon_b)[None, :] - np.radians(lon_a)[:, None]
    a = np.sin(dlat / 2) ** 2 + np.cos(la) * np.cos(lb) * np.sin(dlon / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def nearest_arrondissement(lat: float, lon: float) -> int | None:
    best, best_d = None, float("inf")
    for arr, (clat, clon) in ARRONDISSEMENT_CENTROIDS.items():
        d = haversine_m(lat, lon, clat, clon)
        if d < best_d:
            best, best_d = arr, d
    return best if best_d <= _MAX_ARR_DIST_M else None


def add_arrondissement_column(panels: pd.DataFrame) -> pd.DataFrame:
    """Ajoute `arrondissement` (Paris uniquement, None ailleurs)."""
    arr = [None] * len(panels)
    is_paris = panels["city"].astype(str).str.lower() == "paris"
    for i, (flag, lat, lon) in enumerate(
        zip(is_paris.tolist(), panels["latitude"].tolist(), panels["longitude"].tolist())
    ):
        if flag:
            arr[i] = nearest_arrondissement(float(lat), float(lon))
    out = panels.copy()
    out["arrondissement"] = pd.array(arr, dtype="Int64")
    return out


@lru_cache(maxsize=1)
def load_stores() -> pd.DataFrame:
    if not STORES_PATH.exists():
        return pd.DataFrame(
            columns=["store_id", "enseigne", "name", "address", "city", "arrondissement", "latitude", "longitude"]
        )
    df = pd.read_csv(STORES_PATH)
    df["arrondissement"] = pd.to_numeric(df["arrondissement"], errors="coerce").astype("Int64")
    return df


def normalize_enseigne(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip().lower()
    s = re.sub(r"^(les\s+|le\s+|la\s+)?(magasins?|boutiques?|caves?)\s+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s in ENSEIGNE_ALIASES:
        return ENSEIGNE_ALIASES[s]
    for alias, canon in ENSEIGNE_ALIASES.items():
        if alias in s:
            return canon
    known = list_enseignes()
    for k in known:
        if k.lower() == s:
            return k
    return None


def list_enseignes() -> list[str]:
    df = load_stores()
    if df.empty:
        return []
    return sorted(df["enseigne"].dropna().unique().tolist())


def stores_for(
    enseigne: str,
    cities: list[str] | None = None,
    arrondissement: int | None = None,
) -> pd.DataFrame:
    df = load_stores()
    if df.empty:
        return df
    out = df[df["enseigne"].str.lower() == enseigne.lower()]
    if cities:
        cl = {c.lower() for c in cities if c}
        out = out[out["city"].str.lower().isin(cl)]
    if arrondissement:
        out = out[out["arrondissement"] == int(arrondissement)]
    return out.copy()


def parse_arrondissement(text: str) -> int | None:
    """« 15ème », « 15e arrondissement », « Paris 15 », « dans le 15 » → 15."""
    t = (text or "").lower()
    m = re.search(r"\b(\d{1,2})\s*(?:ème|eme|er|e)\b\s*(?:arr(?:ondissement)?\.?)?", t)
    if not m:
        m = re.search(r"\b(\d{1,2})\s*arrondissement", t)
    if not m:
        m = re.search(r"paris\s+(\d{1,2})\b", t)
    if not m:
        m = re.search(r"\bdans\s+le\s+(\d{1,2})\b(?!\s*(?:k|€|panneaux|faces|jours))", t)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 20:
            return n
    return None


def parse_enseigne(text: str) -> str | None:
    """Détecte une enseigne connue dans le message (« magasins maison nicolas »…)."""
    t = (text or "").lower()
    # aliases les plus longs d'abord pour éviter « carrefour » avant « carrefour city »
    for alias in sorted(ENSEIGNE_ALIASES.keys(), key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", t):
            return ENSEIGNE_ALIASES[alias]
    for k in list_enseignes():
        if re.search(rf"\b{re.escape(k.lower())}\b", t):
            return k
    return None


def parse_distance_m(text: str) -> int | None:
    """« à moins de 300 m », « dans un rayon de 1 km » → mètres."""
    t = (text or "").lower()
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(km|kilom[èe]tres?)\b", t)
    if m:
        return int(float(m.group(1).replace(",", ".")) * 1000)
    m = re.search(r"(\d{2,4})\s*(?:m|mètres|metres)\b", t)
    if m:
        return int(m.group(1))
    return None
