'use client';

import { useEffect, useRef, useState } from "react";
import { Plus, ArrowRight, Download, CalendarCheck } from "lucide-react";
import dynamic from "next/dynamic";

import type { Store } from "./components/MapView";
import { getApiBase } from "../lib/get-api-base";

const MapView = dynamic(
  () => import("./components/MapView").then((m) => m.MapView),
  { ssr: false, loading: () => <div style={{ height: 504 }} className="animate-pulse bg-[#f7f8fa]" /> },
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
type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

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
  for (const k of PLAN_KEYS) if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
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
      if ((data?.results?.length ?? 0) > 0) setPlan({ recommendation: data, criteria: next });
      else setNote("Aucune face ne correspond à ces filtres — élargissez le rayon ou la zone.");
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
    setNote(`Pré-réservation enregistrée (démo) : ${faces} faces, ${fmtCompact(rec?.estimated_impressions)} impressions sur ${durTxt}${budgetTxt}.`);
  }

  const facesCount = rec?.faces ?? panels.length;
  const impressions = rec?.estimated_impressions;
  const budget = rec?.estimated_budget;
  const durationLabel = rec?.duration_days ? `${rec.duration_days} j` : "—";

  const arrValue = criteria.arrondissement ? String(criteria.arrondissement) : "";
  const enseigneValue = (criteria.enseigne as string) || "";
  const distValue = criteria.max_distance_m ? String(criteria.max_distance_m) : "";
  const targetValue = (criteria.target as string) || "";
  const topKValue = criteria.top_k ? String(criteria.top_k) : "";
  const durDaysValue = criteria.duration_days ? String(criteria.duration_days) : "";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header
        style={{
          background: "var(--surface)",
          borderBottom: "1.5px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            height: 60,
            maxWidth: 1600,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <Logo />
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                padding: "7px 18px",
                borderRadius: 8,
                background: "var(--navy)",
                color: "#fff",
                fontSize: "13.5px",
                fontWeight: 600,
              }}
            >
              Construire mon dispositif
            </span>
            <span
              style={{
                padding: "7px 18px",
                borderRadius: 8,
                color: "var(--text-secondary)",
                fontSize: "13.5px",
                fontWeight: 500,
                cursor: "default",
              }}
            >
              Concevoir mon visuel
            </span>
          </nav>
          <button
            style={{
              padding: "9px 20px",
              background: "var(--navy)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "13.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Mon espace client
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, maxWidth: 1600, margin: "0 auto", width: "100%", padding: "24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "var(--text-primary)" }}>
            Construire mon dispositif
          </h1>
          <button
            onClick={resetAll}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              background: "transparent",
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={14} /> Nouveau brief
          </button>
        </div>

        {/* 3-col grid */}
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr 260px", gap: 16, alignItems: "start" }}>
          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Besoin / chat */}
            <div style={{ background: "var(--navy)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
              <div style={{ padding: "18px 20px 16px" }}>
                <h2 style={{ margin: "0 0 14px", color: "#fff", fontSize: "14px", fontWeight: 700, textAlign: "center" }}>
                  Quel est votre besoin de communication ?
                </h2>

                <div ref={threadRef} style={{ maxHeight: 240, overflowY: "auto", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {messages.length === 0 && (
                    <p style={{ margin: 0, fontSize: "12.5px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                      Décrivez votre campagne : enseigne, zone (ville, arrondissement), cible… Le dispositif s'affiche
                      sur la carte, puis vous l'affinez en discutant.
                    </p>
                  )}
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} style={{ background: "rgba(255,255,255,0.92)", borderRadius: "var(--radius-sm)", padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                          {highlightArr(m.content)}
                        </p>
                      </div>
                    ) : (
                      <div key={m.id} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: "12.5px", color: "rgba(255,255,255,0.78)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                          {m.content}
                        </p>
                      </div>
                    ),
                  )}
                  {loading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.6)", fontSize: "12.5px" }}>
                      <Dots /> Analyse du brief…
                    </div>
                  )}
                </div>

                {/* Input */}
                <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "var(--radius-sm)", padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={2}
                    placeholder="Ex. campagne à proximité des magasins Nicolas dans le 15e…"
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", color: "rgba(255,255,255,0.9)", fontSize: "12.5px", fontFamily: "inherit", lineHeight: 1.5 }}
                  />
                  <button
                    onClick={() => send()}
                    disabled={loading || !input.trim()}
                    aria-label="Envoyer"
                    style={{ width: 30, height: 30, minWidth: 30, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: loading || !input.trim() ? "not-allowed" : "pointer", marginTop: 2, opacity: loading || !input.trim() ? 0.5 : 1, color: "#fff" }}
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
                <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>
                  Entrée pour envoyer · Maj+Entrée = nouvelle ligne
                </p>
                {chatError && (
                  <p style={{ margin: "8px 0 0", color: "#fecaca", background: "rgba(226,0,26,0.15)", border: "1px solid rgba(226,0,26,0.3)", borderRadius: 8, padding: "8px 10px", fontSize: "12px" }}>
                    {chatError}
                  </p>
                )}
              </div>
            </div>

            {/* Explication */}
            <div style={{ background: "var(--navy)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
              <div style={{ padding: "18px 20px" }}>
                <h2 style={{ margin: "0 0 12px", color: "#fff", fontSize: "14px", fontWeight: 700, textAlign: "center" }}>
                  Explication choix des faces vs. brief
                </h2>
                {!rec ? (
                  <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                    Une fois le brief envoyé, vous verrez ici pourquoi chaque face est retenue : distance aux magasins,
                    audience, zone.
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 14px", fontSize: "12px", color: "rgba(255,255,255,0.68)", lineHeight: 1.6 }}>
                      {rec.summary}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                      {criteria.enseigne && <Tag>Enseigne : {criteria.enseigne}</Tag>}
                      {criteria.arrondissement && <Tag>Paris {criteria.arrondissement}e</Tag>}
                      {!criteria.arrondissement && (criteria.city || criteria.cities) && (
                        <Tag>{criteria.cities ? (criteria.cities as string[]).join(", ") : criteria.city}</Tag>
                      )}
                      {rec.radius_m && <Tag>Rayon {rec.radius_m} m</Tag>}
                      {criteria.target && <Tag>Cible : {criteria.target}</Tag>}
                      {rec.eligible_count != null && <Tag>{fmtInt(rec.eligible_count)} faces éligibles</Tag>}
                    </div>
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      {panels.map((p, i) => (
                        <FaceItem key={p.panel_id} num={i + 1} p={p} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* CENTER */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <KpiCard value={rec ? durationLabel : "—"} label="durée de campagne" />
              <KpiCard value={rec ? fmtInt(facesCount) : "—"} label="faces" />
              <KpiCard value={rec ? fmtCompact(impressions) : "—"} label="impressions" />
              <KpiCard value={rec && typeof budget === "number" ? `${fmtInt(budget)} €` : "—"} label="budget" />
            </div>
            <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", overflow: "hidden", border: "1.5px solid var(--border)", position: "relative" }}>
              {(loading || filtering) && (
                <div style={{ position: "absolute", inset: 0, zIndex: 1100, background: "rgba(255,255,255,0.6)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: "var(--navy)", padding: "8px 16px", borderRadius: 999, boxShadow: "var(--shadow-md)", border: "1px solid var(--border)", fontSize: "13px", fontWeight: 600 }}>
                    <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--navy)", borderTopColor: "transparent", display: "inline-block" }} className="animate-spin" />
                    Mise à jour…
                  </div>
                </div>
              )}
              <MapView panels={panels} stores={stores} height={460} />
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              onClick={saveExcel}
              disabled={!plan || exporting}
              style={redBtn(!plan || exporting)}
            >
              <Download size={15} /> {exporting ? "EXPORT…" : "ENREGISTRER"}
            </button>
            <button onClick={preReserve} disabled={!plan} style={redBtn(!plan)}>
              <CalendarCheck size={15} /> PRÉ-RÉSERVER
            </button>
            {note && (
              <p style={{ margin: 0, fontSize: "12px", color: "var(--navy)", background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", boxShadow: "var(--shadow-sm)" }}>
                {note}
              </p>
            )}

            <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", border: "1.5px solid var(--border)", overflow: "hidden" }}>
              <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface-alt)" }}>
                <h3 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>Filtres</h3>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <FilterSelect
                  label="Géographique"
                  value={arrValue}
                  onChange={(v) => applyFilter({ arrondissement: v ? Number(v) : null, city: "Paris" })}
                  options={[{ value: "", label: "Tout Paris" }, ...Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `Paris ${i + 1}e` }))]}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <FilterSelect
                    label="Distance enseigne"
                    value={enseigneValue}
                    onChange={(v) => applyFilter({ enseigne: v || null })}
                    options={[{ value: "", label: "Aucune enseigne" }, ...filterOptions.enseignes.map((e) => ({ value: e, label: e }))]}
                  />
                  <FilterSelect
                    label=""
                    value={distValue}
                    disabled={!enseigneValue}
                    onChange={(v) => applyFilter({ max_distance_m: v ? Number(v) : null })}
                    options={[{ value: "", label: "Rayon auto" }, ...filterOptions.distances_m.map((d) => ({ value: String(d), label: `≤ ${d} m` }))]}
                  />
                </div>
                <FilterSelect
                  label="Segments d'audience"
                  value={targetValue}
                  onChange={(v) => applyFilter({ target: v || null })}
                  options={[
                    { value: "", label: "Tous publics" },
                    { value: "CSP+", label: "CSP+ / premium" },
                    { value: "jeunes actifs", label: "Jeunes actifs" },
                    { value: "familles", label: "Familles" },
                  ]}
                />
                <FilterSelect
                  label="Nombre de faces"
                  value={topKValue}
                  onChange={(v) => applyFilter({ top_k: v ? Number(v) : null })}
                  options={[{ value: "", label: "Auto" }, ...[6, 8, 10, 12, 15].map((n) => ({ value: String(n), label: `${n} faces` }))]}
                />
                <FilterSelect
                  label="Durée de campagne"
                  value={durDaysValue}
                  onChange={(v) => applyFilter({ duration_days: v ? Number(v) : null })}
                  options={[{ value: "", label: "7 jours (par défaut)" }, ...[7, 14, 21, 28].map((d) => ({ value: String(d), label: `${d} jours (${d / 7} sem.)` }))]}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function redBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 12,
    background: "var(--red)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    fontSize: "13.5px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    boxShadow: "0 4px 12px rgba(226,0,26,0.35)",
    opacity: disabled ? 0.45 : 1,
  };
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: "var(--navy)", fontSize: "20px", fontWeight: 800, letterSpacing: "-0.01em" }}>JCDecaux</span>
      <span style={{ width: 22, height: 22, background: "var(--navy)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 3 }}>
        <span style={{ color: "#fff", fontSize: "14px", fontWeight: 700 }}>+</span>
      </span>
    </div>
  );
}

function KpiCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: "var(--navy)", borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, boxShadow: "var(--shadow-md)", flex: 1, minWidth: 0 }}>
      <span style={{ color: "#fff", fontSize: "22px", fontWeight: 700 }}>{value}</span>
      <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{label}</span>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 20, color: "rgba(255,255,255,0.85)", fontSize: "12px", fontWeight: 500 }}>
      {children}
    </span>
  );
}

function FaceItem({ num, p }: { num: number; p: Panel }) {
  return (
    <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.05)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "#fff", fontSize: "12px", fontWeight: 700, minWidth: 0 }}>
          {num}. {p.address || "Panneau"}{" "}
          <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>
            — {p.city}
            {p.arrondissement ? ` ${p.arrondissement}e` : ""}
          </span>
        </span>
        {p.distance_m != null && (
          <span style={{ background: "rgba(124,58,237,0.25)", color: "#c4b5fd", borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>
            {fmtInt(p.distance_m)} m
          </span>
        )}
      </div>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", margin: 0, lineHeight: 1.5 }}>
        {p.nearest_store ? `${p.nearest_store} · ` : ""}
        {fmtInt(p.daily_traffic)} passages/jour
        {typeof p.impressions === "number" ? ` · ≈ ${fmtCompact(p.impressions)} impressions` : ""}
      </p>
      {p.explanation?.trim() && (
        <p style={{ color: "rgba(255,255,255,0.62)", fontSize: "11px", margin: "6px 0 0", lineHeight: 1.55 }}>
          {p.explanation}
        </p>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <label style={{ color: "var(--text-secondary)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {label}
        </label>
      )}
      <select className="fig-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="animate-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.6)" }} />
      ))}
    </span>
  );
}

// Met en rouge « 15ème / 15e » dans le message client (détail Figma).
function highlightArr(text: string): React.ReactNode {
  const parts = text.split(/(\d{1,2}\s?(?:ème|eme|e)\b)/gi);
  return parts.map((part, i) =>
    /\d{1,2}\s?(?:ème|eme|e)\b/i.test(part) ? (
      <span key={i} style={{ color: "var(--red)", fontWeight: 600 }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
