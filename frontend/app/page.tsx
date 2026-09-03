'use client';

import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Download, CalendarCheck } from "lucide-react";
import dynamic from "next/dynamic";

import type { Store } from "./components/MapView";
import { getApiBase } from "../lib/get-api-base";

const MapView = dynamic(
  () => import("./components/MapView").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[560px] rounded-md bg-[#dfe6ea] animate-pulse" /> },
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
  duration_days?: number;
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

// Budget indicatif du dispositif (POC) — brique demandée à côté des impressions.
const BUDGET_EUR = 2500;

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
    setNote(
      `Pré-réservation enregistrée (démo) : ${faces} faces, ${fmtCompact(rec?.estimated_impressions)} impressions estimées sur ${rec?.duration_days ?? 14} jours.`,
    );
  }

  const agglos = rec?.agglomeration_count ?? (rec ? new Set(panels.map((p) => p.city)).size : 0);
  const facesCount = rec?.faces ?? panels.length;
  const impressions = rec?.estimated_impressions;

  const enseigneValue = (criteria.enseigne as string) || "";
  const arrValue = criteria.arrondissement ? String(criteria.arrondissement) : "";
  const distValue = criteria.max_distance_m ? String(criteria.max_distance_m) : "";
  const targetValue = (criteria.target as string) || "";
  const topKValue = criteria.top_k ? String(criteria.top_k) : "";

  return (
    <main className="min-h-screen p-5 md:p-8">
      <div className="max-w-[1440px] mx-auto">
        {/* Bandeau */}
        <header className="flex items-center justify-between mb-8">
          <div className="text-3xl md:text-4xl font-extrabold tracking-tight text-[#111]">
            JCDecaux <span className="font-light align-top text-4xl md:text-5xl leading-none">+</span>
          </div>
          <nav className="flex items-center gap-6 md:gap-10 text-sm">
            <span className="font-bold text-[#111]">Construire mon dispositif</span>
            <span className="text-[#333] hidden sm:inline">Concevoir mon visuel</span>
            <button className="jcd-block px-5 py-3 text-sm font-semibold">Mon espace client</button>
          </nav>
        </header>

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl md:text-2xl font-medium text-[#111]">Construire mon dispositif</h1>
          {messages.length > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-[#1f5f7f] hover:underline flex items-center gap-1"
            >
              <RotateCcw size={14} /> Nouveau brief
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Colonne gauche : besoin (chat) + explication */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            <section className="jcd-block p-5 flex flex-col min-h-[440px]">
              <h2 className="text-lg font-medium text-center mb-4">
                Quel est votre besoin de communication ?
              </h2>

              <div ref={threadRef} className="flex-1 overflow-auto space-y-3 mb-3 max-h-[320px] pr-1">
                {messages.length === 0 && (
                  <p className="text-sm text-white/80 text-center mt-6 px-2">
                    Décrivez votre campagne : enseigne, zone (ville, arrondissement), cible…
                    Le dispositif s'affiche sur la carte, puis vous l'affinez en discutant.
                  </p>
                )}
                {messages.map((m) => (
                  <Bubble key={m.id} role={m.role} content={m.content} />
                ))}
                {loading && (
                  <div className="text-sm text-white/80 flex items-center gap-2">
                    <span className="inline-flex gap-1">
                      <Dot /> <Dot /> <Dot />
                    </span>
                    Analyse du brief et sélection des faces…
                  </div>
                )}
              </div>

              <div className="relative rounded-md bg-white text-[#111]">
                <textarea
                  className="w-full min-h-[76px] max-h-40 bg-transparent px-3 py-2.5 pr-12 text-sm outline-none resize-none rounded-md"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ex. campagne à proximité des magasins Nicolas dans le 15e…"
                />
                <button
                  onClick={() => send()}
                  disabled={loading || !input.trim()}
                  aria-label="Envoyer"
                  className="absolute right-2 bottom-2 h-8 w-8 rounded-full bg-[#1f5f7f] text-white flex items-center justify-center hover:bg-[#163f56] disabled:opacity-40"
                >
                  <Send size={15} />
                </button>
              </div>
              <p className="text-[11px] text-white/60 mt-1.5">Entrée pour envoyer · Maj+Entrée = nouvelle ligne</p>
              {chatError && (
                <p className="mt-2 text-xs bg-white/15 border border-white/30 rounded-md p-2">{chatError}</p>
              )}
            </section>

            <section className="jcd-block p-5 min-h-[260px] flex flex-col">
              <h2 className="text-lg font-medium text-center mb-3">Explication choix des faces vs. brief</h2>
              {!rec ? (
                <p className="text-sm text-white/75 text-center mt-4">
                  Une fois le brief envoyé, vous verrez ici pourquoi chaque face est retenue :
                  distance aux magasins, audience, zone.
                </p>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="text-sm leading-relaxed">{rec.summary}</p>
                  <div className="mt-3 text-xs text-white/85 flex flex-wrap gap-2">
                    {criteria.enseigne && <Tag>Enseigne : {criteria.enseigne}</Tag>}
                    {criteria.arrondissement && <Tag>Paris {criteria.arrondissement}e</Tag>}
                    {!criteria.arrondissement && (criteria.city || criteria.cities) && (
                      <Tag>{criteria.cities ? (criteria.cities as string[]).join(", ") : criteria.city}</Tag>
                    )}
                    {rec.radius_m && <Tag>Rayon {rec.radius_m} m</Tag>}
                    {criteria.target && <Tag>Cible : {criteria.target}</Tag>}
                    {rec.eligible_count != null && <Tag>{fmtInt(rec.eligible_count)} faces éligibles</Tag>}
                  </div>
                  <ul className="mt-4 space-y-2 overflow-auto max-h-[380px] pr-1">
                    {panels.map((p, i) => (
                      <li key={p.panel_id} className="rounded-md bg-white/10 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold">
                            {i + 1}. {p.format} — {p.city}
                            {p.arrondissement ? ` ${p.arrondissement}e` : ""} · {p.district}
                          </div>
                          {p.distance_m != null && (
                            <div className="shrink-0 text-xs bg-white text-[#1f5f7f] font-bold rounded px-2 py-0.5">
                              {fmtInt(p.distance_m)} m
                            </div>
                          )}
                        </div>
                        {p.address && <div className="text-xs text-white/70 mt-0.5">{p.address}</div>}
                        <div className="text-xs text-white/80 mt-1">
                          {p.nearest_store ? `${p.nearest_store} · ` : ""}
                          {fmtInt(p.daily_traffic)} passages/jour
                          {typeof p.impressions === "number" ? ` · ≈ ${fmtCompact(p.impressions)} impressions` : ""}
                        </div>
                        {p.explanation?.trim() && (
                          <p className="text-xs leading-relaxed mt-1.5 text-white/90">{p.explanation}</p>
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
              <Chip value={rec ? String(agglos) : "—"} label={agglos > 1 ? "agglomérations" : "agglomération"} />
              <Chip value={rec ? fmtInt(facesCount) : "—"} label="faces" />
              <Chip value={rec ? fmtCompact(impressions) : "—"} label="impressions" />
              <Chip
                value={rec ? `${new Intl.NumberFormat("fr-FR").format(BUDGET_EUR)} €` : "—"}
                label="budget"
              />
            </div>
            <section className="jcd-block p-2 relative">
              {(loading || filtering) && (
                <div className="absolute inset-0 z-[1100] bg-[#1f5f7f]/40 flex items-center justify-center rounded-md">
                  <span className="bg-white text-[#1f5f7f] text-sm font-semibold px-4 py-2 rounded shadow">
                    Mise à jour de la carte…
                  </span>
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
              className="jcd-red rounded-md py-2.5 text-sm font-bold tracking-wide flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Download size={16} /> {exporting ? "EXPORT…" : "ENREGISTRER"}
            </button>
            <button
              onClick={preReserve}
              disabled={!plan}
              className="jcd-red rounded-md py-2.5 text-sm font-bold tracking-wide flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <CalendarCheck size={16} /> PRE-RESERVER
            </button>
            {note && (
              <p className="text-xs text-[#1f5f7f] bg-white rounded-md border border-[#1f5f7f]/30 p-2">{note}</p>
            )}

            <h3 className="text-lg font-medium mt-3 text-[#111]">Filtres</h3>

            <FilterBox label="Géographique">
              <select
                value={arrValue}
                onChange={(e) => applyFilter({ arrondissement: e.target.value ? Number(e.target.value) : null, city: "Paris" })}
                className="jcd-select"
              >
                <option value="">Tout Paris</option>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Paris {n}e
                  </option>
                ))}
              </select>
            </FilterBox>

            <FilterBox label="Distance Enseigne">
              <select
                value={enseigneValue}
                onChange={(e) => applyFilter({ enseigne: e.target.value || null })}
                className="jcd-select mb-1.5"
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
                className="jcd-select"
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

            <FilterBox label="Segments d'audience">
              <select
                value={targetValue}
                onChange={(e) => applyFilter({ target: e.target.value || null })}
                className="jcd-select"
              >
                <option value="">Tous publics</option>
                <option value="CSP+">CSP+ / premium</option>
                <option value="jeunes actifs">Jeunes actifs</option>
                <option value="familles">Familles</option>
              </select>
            </FilterBox>

            <FilterBox label="Nombre de faces">
              <select
                value={topKValue}
                onChange={(e) => applyFilter({ top_k: e.target.value ? Number(e.target.value) : null })}
                className="jcd-select"
              >
                <option value="">Auto</option>
                {[6, 8, 10, 12, 15].map((n) => (
                  <option key={n} value={n}>
                    {n} faces
                  </option>
                ))}
              </select>
            </FilterBox>
          </div>
        </div>
      </div>
    </main>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-md px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-white text-[#111]" : "bg-white/15 text-white border border-white/20"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" />;
}

function Chip({ value, label }: { value: string; label: string }) {
  return (
    <div className="jcd-block py-3 px-2 text-center">
      <div className="text-xl font-semibold leading-tight">{value}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-white/15 border border-white/25 px-2 py-0.5">{children}</span>;
}

function FilterBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="jcd-block p-2.5">
      <div className="text-xs text-center mb-1.5">{label}</div>
      {children}
    </div>
  );
}
