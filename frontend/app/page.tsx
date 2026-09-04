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
  { ssr: false, loading: () => <div className="h-[560px] rounded-xl bg-slate-100 animate-pulse" /> },
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
        <header className="flex items-center justify-between mb-7 pb-4 border-b border-slate-200/70">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">JCDecaux</span>
            <span className="text-3xl md:text-4xl font-light leading-none text-[#1f5f7f]">+</span>
          </div>
          <nav className="flex items-center gap-2 md:gap-3 text-sm">
            <span className="px-3 py-2 rounded-lg font-semibold text-[#1f5f7f] bg-[#1f5f7f]/10">Construire mon dispositif</span>
            <span className="px-3 py-2 rounded-lg text-slate-500 hover:text-slate-800 hidden sm:inline cursor-default transition">Concevoir mon visuel</span>
            <button className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#1f5f7f] hover:bg-[#163f56] shadow-sm transition">Mon espace client</button>
          </nav>
        </header>

        <div className="flex items-end justify-between mb-5">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Construire mon dispositif</h1>
            <p className="text-sm text-slate-500 mt-1">
              Décrivez votre besoin — l'IA compose et cartographie votre plan média.
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-slate-500 hover:text-[#1f5f7f] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-slate-100 transition"
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
                <div className="h-9 w-9 rounded-xl grid place-items-center bg-[#1f5f7f]/10 text-[#1f5f7f]">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 leading-tight">Votre besoin de communication</h2>
                  <p className="text-[11px] text-slate-400">Assistant IA · langage naturel</p>
                </div>
              </div>

              <div ref={threadRef} className="flex-1 overflow-auto thin-scroll space-y-3 mb-3 max-h-[300px] pr-1">
                {messages.length === 0 && (
                  <div className="text-sm text-slate-500 rounded-xl bg-slate-50 border border-slate-100 p-4">
                    Décrivez votre campagne : enseigne, zone (ville, arrondissement), cible…
                    Le dispositif s'affiche sur la carte, puis vous l'affinez en discutant.
                  </div>
                )}
                {messages.map((m) => (
                  <Bubble key={m.id} role={m.role} content={m.content} />
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <div className="h-7 w-7 rounded-full grid place-items-center bg-slate-100 text-[#1f5f7f]">
                      <Bot size={15} />
                    </div>
                    <span className="inline-flex gap-1">
                      <Dot /> <Dot /> <Dot />
                    </span>
                    <span>Analyse du brief…</span>
                  </div>
                )}
              </div>

              <div className="relative rounded-2xl border border-slate-200 bg-white focus-within:border-[#1f5f7f] focus-within:ring-4 focus-within:ring-[#1f5f7f]/10 transition">
                <textarea
                  className="w-full min-h-[74px] max-h-40 bg-transparent px-3.5 py-3 pr-12 text-sm outline-none resize-none rounded-2xl text-slate-800 placeholder:text-slate-400"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ex. campagne à proximité des magasins Nicolas dans le 15e…"
                />
                <button
                  onClick={() => send()}
                  disabled={loading || !input.trim()}
                  aria-label="Envoyer"
                  className="absolute right-2.5 bottom-2.5 h-9 w-9 rounded-xl bg-[#1f5f7f] text-white grid place-items-center hover:bg-[#163f56] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">Entrée pour envoyer · Maj+Entrée = nouvelle ligne</p>
              {chatError && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{chatError}</p>
              )}
            </section>

            <section className="card p-5 flex flex-col">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="h-9 w-9 rounded-xl grid place-items-center bg-[#1f5f7f]/10 text-[#1f5f7f]">
                  <Target size={18} />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">Pourquoi ces faces ? (vs. brief)</h2>
              </div>
              {!rec ? (
                <div className="text-sm text-slate-500 rounded-xl bg-slate-50 border border-slate-100 p-4">
                  Une fois le brief envoyé, vous verrez ici pourquoi chaque face est retenue :
                  distance aux magasins, audience, zone.
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="text-sm leading-relaxed text-slate-600">{rec.summary}</p>
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
                        className="rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-white hover:border-slate-200 hover:shadow-sm p-3 transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[#1f5f7f] text-white text-[11px] font-bold grid place-items-center">
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 text-[13px] leading-snug truncate">
                                {p.address || "Panneau"}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {p.city}
                                {p.arrondissement ? ` ${p.arrondissement}e` : ""}
                                {p.nearest_store ? ` · ${p.nearest_store}` : ""}
                              </div>
                            </div>
                          </div>
                          {p.distance_m != null && (
                            <div className="shrink-0 text-[11px] bg-[#1f5f7f]/10 text-[#1f5f7f] font-bold rounded-full px-2 py-0.5">
                              {fmtInt(p.distance_m)} m
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1.5 pl-7">
                          {fmtInt(p.daily_traffic)} passages/jour
                          {typeof p.impressions === "number" ? ` · ≈ ${fmtCompact(p.impressions)} impressions` : ""}
                        </div>
                        {p.explanation?.trim() && (
                          <p className="text-xs leading-relaxed mt-1.5 pl-7 text-slate-600">{p.explanation}</p>
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
              <Chip icon={<Clock size={18} />} value={rec ? durationLabel : "—"} label="durée de campagne" accent="#6366f1" />
              <Chip icon={<Monitor size={18} />} value={rec ? fmtInt(facesCount) : "—"} label="faces" accent="#1f5f7f" />
              <Chip icon={<Eye size={18} />} value={rec ? fmtCompact(impressions) : "—"} label="impressions" accent="#0891b2" />
              <Chip
                icon={<Wallet size={18} />}
                value={rec && typeof budget === "number" ? `${fmtInt(budget)} €` : "—"}
                label="budget"
                accent="#059669"
              />
            </div>
            <section className="card p-3 relative">
              <div className="flex items-center gap-2 px-1 pb-2">
                <MapPin size={16} className="text-[#1f5f7f]" />
                <h2 className="text-sm font-semibold text-slate-900">Carte des faces</h2>
                {rec?.distance_stats && (
                  <span className="text-[11px] text-slate-400 ml-auto">
                    distance moyenne {rec.distance_stats.avg_m} m
                  </span>
                )}
              </div>
              {(loading || filtering) && (
                <div className="absolute inset-0 z-[1100] bg-white/60 backdrop-blur-[2px] grid place-items-center rounded-2xl">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-[#1f5f7f] bg-white px-4 py-2 rounded-full shadow-md">
                    <span className="h-4 w-4 rounded-full border-2 border-[#1f5f7f] border-t-transparent animate-spin" />
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
              className="w-full rounded-xl py-3 text-sm font-semibold text-white bg-[#1f5f7f] hover:bg-[#163f56] shadow-sm inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Download size={16} /> {exporting ? "Export…" : "Enregistrer"}
            </button>
            <button
              onClick={preReserve}
              disabled={!plan}
              className="w-full rounded-xl py-3 text-sm font-semibold text-[#1f5f7f] bg-white border border-[#1f5f7f]/30 hover:bg-[#1f5f7f]/5 inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <CalendarCheck size={16} /> Pré-réserver
            </button>
            {note && (
              <p className="text-xs text-[#1f5f7f] bg-[#1f5f7f]/5 rounded-xl border border-[#1f5f7f]/15 p-2.5">{note}</p>
            )}

            <div className="card p-4 mt-1">
              <div className="flex items-center gap-2 mb-3.5">
                <Filter size={16} className="text-[#1f5f7f]" />
                <h3 className="text-sm font-semibold text-slate-900">Filtres</h3>
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

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-[#1f5f7f] text-white shadow-sm">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="h-7 w-7 shrink-0 rounded-full grid place-items-center bg-slate-100 text-[#1f5f7f]">
        <Bot size={15} />
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-slate-100 text-slate-700">
        {content}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-[#1f5f7f]/70 animate-pulse" />;
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
          style={{ backgroundColor: `${accent ?? "#1f5f7f"}1a`, color: accent ?? "#1f5f7f" }}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums text-slate-900 leading-none truncate">{value}</div>
        <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-1.5">{label}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5">
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
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}
