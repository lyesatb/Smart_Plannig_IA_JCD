'use client';

import { useEffect, useRef, useState } from "react";
import {
  Send, RotateCcw, Download, CalendarCheck, Sparkles, Bot, Target, MapPin,
  Clock, Monitor, Eye, Wallet, Filter, Store as StoreIcon, Users,
} from "lucide-react";
import dynamic from "next/dynamic";

import type { Store } from "./components/MapView";
import { getApiBase } from "../lib/get-api-base";

const MapView = dynamic(
  () => import("./components/MapView").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[560px] rounded-xl bg-white/5 animate-pulse" /> },
);

type Panel = {
  panel_id: string;
  city: string;
  arrondissement?: number | null;
  latitude: number;
  longitude: number;
  district: string;
  format: string;
  daily_traffic: number;
  impressions?: number;
  visibility_score: number;
  audience_csp_plus: number;
  audience_young_active: number;
  poi_nearby: string;
  distance_m?: number | null;
  nearest_store?: string | null;
  nearest_store_address?: string | null;
  address?: string | null;
  explanation?: string;
};

type Recommendation = {
  summary?: string;
  results?: Panel[];
  faces?: number;
  agglomerations?: string[];
  agglomeration_count?: number;
  estimated_impressions?: number;
  estimated_daily_reach?: number;
  estimated_budget?: number;
  duration_days?: number;
  duration_weeks?: number;
  distance_stats?: { min_m: number; max_m: number; avg_m: number } | null;
  radius_m?: number | null;
  stores?: Store[];
  eligible_count?: number;
};

type Plan = { recommendation: Recommendation; criteria: Record<string, any> };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_PROMPT =
  "Je veux une campagne en proximité des magasins Maison Nicolas dans le 15ème arrondissement de Paris";

const PLAN_KEYS = [
  "city", "cities", "target", "industry", "budget", "duration_days", "objective", "poi",
  "top_k", "per_city", "city_quotas", "enseigne", "arrondissement", "max_distance_m",
];

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function fmtInt(n?: number | null) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

function fmtCompact(n?: number | null) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
    return String(n);
  }
}

function pickPlanCriteria(c: Record<string, any> | undefined | null) {
  const out: Record<string, any> = {};
  if (!c) return out;
  for (const k of PLAN_KEYS) {
    if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  }
  return out;
}

export default function Home() {
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [filterOptions, setFilterOptions] = useState<{ enseignes: string[]; distances_m: number[] }>({
    enseignes: [],
    distances_m: [300, 500, 800, 1200, 2000],
  });
  const [filtering, setFiltering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getApiBase().then(setApiBase);
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/enseignes`)
      .then((r) => r.json())
      .then((d) =>
        setFilterOptions({
          enseignes: Array.isArray(d?.enseignes) ? d.enseignes : [],
          distances_m: Array.isArray(d?.distances_m) ? d.distances_m : [300, 500, 800, 1200, 2000],
        }),
      )
      .catch(() => undefined);
  }, [apiBase]);

  // Défilement interne au bloc de discussion (pas de saut de page).
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const rec = plan?.recommendation ?? null;
  const panels: Panel[] = rec?.results ?? [];
  const stores: Store[] = rec?.stores ?? [];
  const criteria = plan?.criteria ?? {};

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    if (!apiBase) {
      setChatError("API non configurée : lancez le backend (uvicorn) sur http://localhost:8000.");
      return;
    }
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const priorCriteria = plan ? pickPlanCriteria(plan.criteria) : null;

    setMessages((prev) => [...prev, { id: newId(), role: "user", content }]);
    setInput("");
    setLoading(true);
    setChatError(null);
    setNote(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history, prior_criteria: priorCriteria }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: data.assistant_message || "Dispositif mis à jour." },
      ]);
      if ((data?.recommendation?.results?.length ?? 0) > 0) {
        setPlan({ recommendation: data.recommendation, criteria: data.extracted_criteria || {} });
      }
    } catch (e) {
      const err = e as Error;
      setChatError(
        err.name === "AbortError"
          ? "Délai dépassé. Réessayez dans quelques secondes."
          : `Impossible de joindre l'API (${apiBase}). Vérifiez que le backend tourne.`,
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function resetAll() {
    setMessages([]);
    setPlan(null);
    setChatError(null);
    setNote(null);
    setInput(DEFAULT_PROMPT);
  }

  /** Filtres (colonne droite) : relance le moteur avec les critères courants + le filtre. */
  async function applyFilter(overrides: Record<string, any>) {
    if (!apiBase) return;
    const base = plan ? pickPlanCriteria(plan.criteria) : { city: "Paris", top_k: 12 };
    const next: Record<string, any> = { ...base, ...overrides };
    for (const k of Object.keys(next)) {
      if (next[k] === null || next[k] === undefined || next[k] === "") delete next[k];
    }
    if (next.arrondissement && !next.city && !next.cities) next.city = "Paris";
    setFiltering(true);
    setNote(null);
    try {
      const res = await fetch(`${apiBase}/recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Recommendation = await res.json();
      if ((data?.results?.length ?? 0) > 0) {
        setPlan({ recommendation: data, criteria: next });
      } else {
        setNote("Aucune face ne correspond à ces filtres — élargissez le rayon ou la zone.");
      }
    } catch {
      setNote("Impossible d'appliquer le filtre (API injoignable).");
    } finally {
      setFiltering(false);
    }
  }

  async function saveExcel() {
    if (!apiBase || !plan) return;
    setExporting(true);
    try {
      const recommendation_explanations: Record<string, string> = {};
      for (const p of panels) {
        if (p.panel_id && p.explanation?.trim()) recommendation_explanations[p.panel_id] = p.explanation.trim();
      }
      const res = await fetch(`${apiBase}/export/plan-retenu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pickPlanCriteria(plan.criteria), recommendation_explanations }),
      });
      if (!res.ok) throw new Error("export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dispositif_jcdecaux.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setNote("Dispositif enregistré (export Excel téléchargé).");
    } catch {
      setNote("Échec de l'enregistrement — réessayez.");
    } finally {
      setExporting(false);
    }
  }

  function preReserve() {
    if (!plan) return;
    const faces = rec?.faces ?? panels.length;
    const durTxt = `${rec?.duration_days ?? 7} jours`;
    const budgetTxt = typeof budget === "number" ? `, budget ${fmtInt(budget)} €` : "";
    setNote(
      `Pré-réservation enregistrée (démo) : ${faces} faces, ${fmtCompact(rec?.estimated_impressions)} impressions sur ${durTxt}${budgetTxt}.`,
    );
  }

  const facesCount = rec?.faces ?? panels.length;
  const impressions = rec?.estimated_impressions;
  const budget = rec?.estimated_budget;
  const durationLabel = rec?.duration_days ? `${rec.duration_days} j` : "—";

  const enseigneValue = (criteria.enseigne as string) || "";
  const arrValue = criteria.arrondissement ? String(criteria.arrondissement) : "";
  const distValue = criteria.max_distance_m ? String(criteria.max_distance_m) : "";
  const targetValue = (criteria.target as string) || "";
  const topKValue = criteria.top_k ? String(criteria.top_k) : "";
  const durDaysValue = criteria.duration_days ? String(criteria.duration_days) : "";

  return (
    <main className="min-h-screen p-4 md:p-7">
      <div className="max-w-[1480px] mx-auto">
        {/* Bandeau */}
        <header className="flex items-center justify-between mb-7 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <JcdLogo className="h-9 w-auto" />
            <span className="hidden md:inline text-[10px] uppercase tracking-[0.28em] text-cyan-300/70 border-l border-white/10 pl-3">
              Smart Planning
            </span>
          </div>
          <nav className="flex items-center gap-2 md:gap-3 text-sm">
            <span className="px-3 py-2 rounded-lg font-semibold text-cyan-300 bg-cyan-400/10 border border-cyan-400/20">Construire mon dispositif</span>
            <span className="px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 hidden sm:inline cursor-default transition">Concevoir mon visuel</span>
            <button className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#0e7490] to-[#0891b2] hover:from-[#0891b2] hover:to-[#06b6d4] shadow-lg shadow-cyan-500/10 transition">Mon espace client</button>
          </nav>
        </header>

        <div className="flex items-end justify-between mb-5">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Construire mon dispositif</h1>
            <p className="text-sm text-slate-400 mt-1">
              Décrivez votre besoin — l'IA compose et cartographie votre plan média.
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-slate-400 hover:text-cyan-300 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-white/5 transition"
            >
              <RotateCcw size={14} /> Nouveau brief
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Colonne gauche : besoin (chat) + explication */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            <section className="card p-5 flex flex-col min-h-[460px]">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="h-9 w-9 rounded-xl grid place-items-center bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white leading-tight">Votre besoin de communication</h2>
                  <p className="text-[11px] text-slate-500">Assistant IA · langage naturel</p>
                </div>
              </div>

              <div ref={threadRef} className="flex-1 overflow-auto thin-scroll space-y-3 mb-3 max-h-[300px] pr-1">
                {messages.length === 0 && (
                  <div className="text-sm text-slate-400 rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    Décrivez votre campagne : enseigne, zone (ville, arrondissement), cible…
                    Le dispositif s'affiche sur la carte, puis vous l'affinez en discutant.
                  </div>
                )}
                {messages.map((m) => (
                  <Bubble key={m.id} role={m.role} content={m.content} />
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <div className="h-7 w-7 rounded-full grid place-items-center bg-white/10 text-cyan-300">
                      <Bot size={15} />
                    </div>
                    <span className="inline-flex gap-1">
                      <Dot /> <Dot /> <Dot />
                    </span>
                    <span>Analyse du brief…</span>
                  </div>
                )}
              </div>

              <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] focus-within:border-cyan-400/70 focus-within:ring-4 focus-within:ring-cyan-400/10 transition">
                <textarea
                  className="w-full min-h-[74px] max-h-40 bg-transparent px-3.5 py-3 pr-12 text-sm outline-none resize-none rounded-2xl text-slate-100 placeholder:text-slate-500"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ex. campagne à proximité des magasins Nicolas dans le 15e…"
                />
                <button
                  onClick={() => send()}
                  disabled={loading || !input.trim()}
                  aria-label="Envoyer"
                  className="absolute right-2.5 bottom-2.5 h-9 w-9 rounded-xl bg-gradient-to-r from-[#0e7490] to-[#06b6d4] text-white grid place-items-center hover:brightness-110 shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">Entrée pour envoyer · Maj+Entrée = nouvelle ligne</p>
              {chatError && (
                <p className="mt-2 text-xs text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg p-2.5">{chatError}</p>
              )}
            </section>

            <section className="card p-5 flex flex-col">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="h-9 w-9 rounded-xl grid place-items-center bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
                  <Target size={18} />
                </div>
                <h2 className="text-sm font-semibold text-white">Pourquoi ces faces ? (vs. brief)</h2>
              </div>
              {!rec ? (
                <div className="text-sm text-slate-400 rounded-xl bg-white/[0.03] border border-white/10 p-4">
                  Une fois le brief envoyé, vous verrez ici pourquoi chaque face est retenue :
                  distance aux magasins, audience, zone.
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="text-sm leading-relaxed text-slate-300">{rec.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {criteria.enseigne && <Tag>Enseigne : {criteria.enseigne}</Tag>}
                    {criteria.arrondissement && <Tag>Paris {criteria.arrondissement}e</Tag>}
                    {!criteria.arrondissement && (criteria.city || criteria.cities) && (
                      <Tag>{criteria.cities ? (criteria.cities as string[]).join(", ") : criteria.city}</Tag>
                    )}
                    {rec.radius_m && <Tag>Rayon {rec.radius_m} m</Tag>}
                    {criteria.target && <Tag>Cible : {criteria.target}</Tag>}
                    {rec.eligible_count != null && <Tag>{fmtInt(rec.eligible_count)} faces éligibles</Tag>}
                  </div>
                  <ul className="mt-4 space-y-2 overflow-auto thin-scroll max-h-[400px] pr-1">
                    {panels.map((p, i) => (
                      <li
                        key={p.panel_id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-cyan-400/25 p-3 transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-[#0e7490] to-[#06b6d4] text-white text-[11px] font-bold grid place-items-center">
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 text-[13px] leading-snug truncate">
                                {p.address || "Panneau"}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {p.city}
                                {p.arrondissement ? ` ${p.arrondissement}e` : ""}
                                {p.nearest_store ? ` · ${p.nearest_store}` : ""}
                              </div>
                            </div>
                          </div>
                          {p.distance_m != null && (
                            <div className="shrink-0 text-[11px] bg-cyan-400/15 text-cyan-300 font-bold rounded-full px-2 py-0.5">
                              {fmtInt(p.distance_m)} m
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1.5 pl-7">
                          {fmtInt(p.daily_traffic)} passages/jour
                          {typeof p.impressions === "number" ? ` · ≈ ${fmtCompact(p.impressions)} impressions` : ""}
                        </div>
                        {p.explanation?.trim() && (
                          <p className="text-xs leading-relaxed mt-1.5 pl-7 text-slate-300">{p.explanation}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* Colonne centrale : KPIs + carto */}
          <div className="lg:col-span-6 flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Chip icon={<Clock size={18} />} value={rec ? durationLabel : "—"} label="durée de campagne" accent="#818cf8" />
              <Chip icon={<Monitor size={18} />} value={rec ? fmtInt(facesCount) : "—"} label="faces" accent="#22d3ee" />
              <Chip icon={<Eye size={18} />} value={rec ? fmtCompact(impressions) : "—"} label="impressions" accent="#38bdf8" />
              <Chip
                icon={<Wallet size={18} />}
                value={rec && typeof budget === "number" ? `${fmtInt(budget)} €` : "—"}
                label="budget"
                accent="#34d399"
              />
            </div>
            <section className="card p-3 relative">
              <div className="flex items-center gap-2 px-1 pb-2">
                <MapPin size={16} className="text-cyan-300" />
                <h2 className="text-sm font-semibold text-white">Carte des faces</h2>
                {rec?.distance_stats && (
                  <span className="text-[11px] text-slate-400 ml-auto">
                    distance moyenne {rec.distance_stats.avg_m} m
                  </span>
                )}
              </div>
              {(loading || filtering) && (
                <div className="absolute inset-0 z-[1100] bg-slate-950/60 backdrop-blur-[2px] grid place-items-center rounded-2xl">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 bg-slate-900/90 px-4 py-2 rounded-full shadow-lg border border-white/10">
                    <span className="h-4 w-4 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
                    Mise à jour…
                  </div>
                </div>
              )}
              <MapView panels={panels} stores={stores} height={560} />
            </section>
          </div>

          {/* Colonne droite : actions + filtres */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <button
              onClick={saveExcel}
              disabled={!plan || exporting}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#0e7490] to-[#0891b2] hover:from-[#0891b2] hover:to-[#06b6d4] shadow-lg shadow-cyan-500/10 inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Download size={16} /> {exporting ? "Export…" : "Enregistrer"}
            </button>
            <button
              onClick={preReserve}
              disabled={!plan}
              className="w-full rounded-xl py-3 text-sm font-semibold text-cyan-200 bg-white/5 border border-white/15 hover:bg-white/10 inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <CalendarCheck size={16} /> Pré-réserver
            </button>
            {note && (
              <p className="text-xs text-cyan-200 bg-cyan-400/10 rounded-xl border border-cyan-400/20 p-2.5">{note}</p>
            )}

            <div className="card p-4 mt-1">
              <div className="flex items-center gap-2 mb-3.5">
                <Filter size={16} className="text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">Filtres</h3>
              </div>
              <div className="space-y-3.5">
                <FilterBox icon={<MapPin size={13} />} label="Zone géographique">
                  <select
                    value={arrValue}
                    onChange={(e) => applyFilter({ arrondissement: e.target.value ? Number(e.target.value) : null, city: "Paris" })}
                    className="select-modern"
                  >
                    <option value="">Tout Paris</option>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        Paris {n}e
                      </option>
                    ))}
                  </select>
                </FilterBox>

                <FilterBox icon={<StoreIcon size={13} />} label="Distance enseigne">
                  <select
                    value={enseigneValue}
                    onChange={(e) => applyFilter({ enseigne: e.target.value || null })}
                    className="select-modern mb-2"
                  >
                    <option value="">Aucune enseigne</option>
                    {filterOptions.enseignes.map((en) => (
                      <option key={en} value={en}>
                        {en}
                      </option>
                    ))}
                  </select>
                  <select
                    value={distValue}
                    onChange={(e) => applyFilter({ max_distance_m: e.target.value ? Number(e.target.value) : null })}
                    className="select-modern"
                    disabled={!enseigneValue}
                  >
                    <option value="">Rayon auto</option>
                    {filterOptions.distances_m.map((d) => (
                      <option key={d} value={d}>
                        ≤ {d} m
                      </option>
                    ))}
                  </select>
                </FilterBox>

                <FilterBox icon={<Users size={13} />} label="Segments d'audience">
                  <select
                    value={targetValue}
                    onChange={(e) => applyFilter({ target: e.target.value || null })}
                    className="select-modern"
                  >
                    <option value="">Tous publics</option>
                    <option value="CSP+">CSP+ / premium</option>
                    <option value="jeunes actifs">Jeunes actifs</option>
                    <option value="familles">Familles</option>
                  </select>
                </FilterBox>

                <FilterBox icon={<Monitor size={13} />} label="Nombre de faces">
                  <select
                    value={topKValue}
                    onChange={(e) => applyFilter({ top_k: e.target.value ? Number(e.target.value) : null })}
                    className="select-modern"
                  >
                    <option value="">Auto</option>
                    {[6, 8, 10, 12, 15].map((n) => (
                      <option key={n} value={n}>
                        {n} faces
                      </option>
                    ))}
                  </select>
                </FilterBox>

                <FilterBox icon={<Clock size={13} />} label="Durée de campagne">
                  <select
                    value={durDaysValue}
                    onChange={(e) => applyFilter({ duration_days: e.target.value ? Number(e.target.value) : null })}
                    className="select-modern"
                  >
                    <option value="">7 jours (par défaut)</option>
                    {[7, 14, 21, 28].map((d) => (
                      <option key={d} value={d}>
                        {d} jours ({d / 7} sem.)
                      </option>
                    ))}
                  </select>
                </FilterBox>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function JcdLogo({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 132 50" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="JCDecaux">
      <path d="M106.917 0L0 0.0690088L0.00614371 2.26165L109.111 2.19107L106.917 0Z" fill="url(#jcd_g0)" />
      <path d="M2.19328 2.26165L2.22744 49.9983L0.0326656 50L7.08859e-06 0.0705773L2.19328 2.26165Z" fill="url(#jcd_g1)" />
      <path d="M29.4021 31.8242C29.4041 34.0879 28.794 37.7837 23.5486 37.7861C20.6159 37.7895 17.76 36.1886 17.7548 32.3488L17.7563 30.8207L21.2532 30.8196L21.2519 31.6074C21.2552 33.3085 21.6744 34.539 23.497 34.5361C25.5405 34.5345 25.538 32.8879 25.5373 31.6537L25.5325 19.7851L29.3949 19.7846L29.4021 31.8242Z" fill="white" />
      <path d="M43.3873 25.6829C43.1411 23.9343 41.4698 22.6059 39.5478 22.6079C36.072 22.611 34.7687 25.5647 34.7727 28.6437C34.7722 31.5726 36.0815 34.5284 39.553 34.5266C41.9168 34.5256 43.247 32.8978 43.5387 30.5846L47.2864 30.5825C46.8936 34.9636 43.864 37.7738 39.5562 37.7755C34.1133 37.7814 30.9077 33.7191 30.9068 28.6464C30.9027 23.4272 34.1005 19.3597 39.5424 19.3554C43.4081 19.3543 46.6606 21.6158 47.1335 25.6791L43.3873 25.6829Z" fill="white" />
      <path d="M52.5248 23.0164L55.2794 23.0183C59.1242 23.0136 60.3563 25.2762 60.3584 28.825C60.3605 32.7155 58.2206 34.0968 55.9793 34.0966L52.5331 34.1008L52.5248 23.0164ZM48.6657 37.3486L56.2537 37.3457C61.6215 37.3429 64.2263 33.55 64.2234 28.4541C64.22 22.6162 60.7958 19.7614 56.242 19.7663L48.6556 19.7703L48.6657 37.3486Z" fill="white" />
      <path d="M68.6583 29.6075C68.709 28.6213 69.347 26.8983 71.5657 26.8955C73.2606 26.8941 74.0247 27.8299 74.3484 29.6038L68.6583 29.6075ZM77.8452 31.816C78.0892 27.902 75.9951 24.2567 71.6593 24.2584C67.7929 24.2661 65.1622 27.1718 65.1638 30.9875C65.1662 34.9282 67.6545 37.6851 71.6683 37.6828C74.5508 37.6806 76.6437 36.4003 77.6248 33.3931L74.5469 33.3947C74.3244 34.1837 73.1939 35.0484 71.7924 35.0468C69.8449 35.0498 68.7606 34.0396 68.6598 31.8227L77.8452 31.816Z" fill="white" />
      <path d="M87.8181 29.0797C87.5964 27.6478 86.6851 26.8842 85.2332 26.8856C82.9889 26.8903 82.2522 29.1547 82.2544 31.0291C82.2558 32.849 82.9726 35.0408 85.1633 35.0378C86.7869 35.0357 87.7242 34.004 87.9443 32.4481L91.317 32.4481C90.8749 35.8223 88.539 37.6687 85.188 37.6725C81.3467 37.6759 78.7595 34.9674 78.7579 31.1517C78.7561 27.1864 81.1173 24.2545 85.2552 24.2511C88.2585 24.2476 91.0172 25.8248 91.2406 29.0733L87.8181 29.0797Z" fill="white" />
      <path d="M100.509 32.3935C100.508 33.1584 100.411 35.3243 97.679 35.3263C96.5451 35.3271 95.5359 35.0065 95.5358 33.7026C95.5351 32.4242 96.5207 32.0507 97.6025 31.8274C98.6852 31.6313 99.9159 31.6048 100.508 31.0896L100.509 32.3935ZM95.9265 28.5071C96.0475 27.1272 96.9097 26.5839 98.2383 26.5828C99.4706 26.5845 100.505 26.8037 100.505 28.304C100.505 29.7345 98.5092 29.6615 96.3692 29.9837C94.2018 30.2804 92.0347 30.9698 92.0377 33.8523C92.0384 36.4626 93.9603 37.6659 96.3743 37.6654C97.9222 37.6646 99.5503 37.2464 100.659 36.0864C100.683 36.5068 100.78 36.924 100.904 37.3165L104.451 37.3142C104.131 36.8012 104.009 35.6413 104.007 34.4843L104.004 27.8594C104 24.8068 100.946 24.2429 98.4091 24.2445C95.554 24.245 92.6229 25.2303 92.4288 28.5073L95.9265 28.5071Z" fill="white" />
      <path d="M117.863 37.3066L114.538 37.3111L114.539 35.5373L114.461 35.5359C113.577 36.9671 112.051 37.6541 110.574 37.6573C106.857 37.6571 105.917 35.5692 105.916 32.4149L105.911 24.5828L109.408 24.5783L109.415 31.7732C109.415 33.8649 110.027 34.9002 111.656 34.8969C113.551 34.8966 114.364 33.8379 114.36 31.2519L114.359 24.5769L117.856 24.5759L117.863 37.3066Z" fill="white" />
      <path d="M122.97 30.6043L118.782 24.5733L122.771 24.572L125.014 27.8957L127.228 24.5715L131.091 24.5677L126.913 30.5298L131.618 37.299L127.631 37.3022L124.969 33.2896L122.311 37.3053L118.397 37.3035L122.97 30.6043Z" fill="white" />
      <defs>
        <linearGradient id="jcd_g0" x1="131.619" y1="25.0003" x2="6.8515" y2="54.2361" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0" />
          <stop offset="1" stopColor="white" />
        </linearGradient>
        <linearGradient id="jcd_g1" x1="53.805" y1="10.2735" x2="53.8137" y2="50.0026" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-gradient-to-br from-[#0e7490] to-[#0891b2] text-white shadow-md shadow-cyan-500/10">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="h-7 w-7 shrink-0 rounded-full grid place-items-center bg-white/10 text-cyan-300">
        <Bot size={15} />
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-white/[0.06] border border-white/10 text-slate-200">
        {content}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/80 animate-pulse" />;
}

function Chip({
  icon,
  value,
  label,
  accent,
}: {
  icon?: React.ReactNode;
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="card card-hover p-4 flex items-center gap-3">
      {icon && (
        <div
          className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
          style={{ backgroundColor: `${accent ?? "#22d3ee"}26`, color: accent ?? "#22d3ee" }}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums text-white leading-none truncate">{value}</div>
        <div className="text-[11px] text-slate-400 uppercase tracking-wide mt-1.5">{label}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] rounded-full bg-white/[0.06] text-slate-300 border border-white/10 px-2.5 py-0.5">
      {children}
    </span>
  );
}

function FilterBox({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
        {icon && <span className="text-slate-500">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}
