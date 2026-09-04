'use client';

import { useEffect, useRef, useState } from "react";
import { Plus, ArrowRight, Download, CalendarCheck } from "lucide-react";
import dynamic from "next/dynamic";

import type { Store } from "./components/MapView";
import { getApiBase } from "../lib/get-api-base";

const MapView = dynamic(
  () => import("./components/MapView").then((m) => m.MapView),
  { ssr: false, loading: () => <div style={{ height: 520 }} className="animate-pulse bg-[#f7f8fa]" /> },
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

  const subtitle = (() => {
    if (rec && criteria.enseigne) {
      const zone = criteria.arrondissement
        ? `Paris ${criteria.arrondissement}ème`
        : criteria.cities
          ? (criteria.cities as string[]).join(", ")
          : criteria.city || "";
      return `Campagne en proximité des magasins ${criteria.enseigne}${zone ? ` — ${zone}` : ""}`;
    }
    return "Décrivez votre besoin — l'IA compose et cartographie votre plan média.";
  })();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Bandeau JCDecaux (couleur JCDecaux) */}
      <header
        style={{
          background: "linear-gradient(110deg, #2b5285 0%, #1b3454 48%, #13233c 100%)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          boxShadow: "0 4px 18px rgba(19,35,60,0.28)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            height: 62,
            maxWidth: 1600,
            margin: "0 auto",
            width: "100%",
            color: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ color: "#fff" }}>
              <JcdLogo className="h-7 w-auto" />
            </div>
            <nav style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <span style={{ fontSize: "13.5px", fontWeight: 700 }}>Construire mon dispositif</span>
              <span style={{ fontSize: "13.5px", fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>Concevoir mon visuel</span>
            </nav>
          </div>
          <button
            style={{
              padding: "8px 18px",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Mon espace client
          </button>
        </div>
      </header>

      {/* Contenu */}
      <main style={{ maxWidth: 1600, margin: "0 auto", width: "100%", padding: "22px 28px 32px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "var(--text-primary)" }}>
              Construire mon dispositif
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "13.5px", color: "var(--text-secondary)" }}>{subtitle}</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={resetAll}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                background: "var(--surface)",
                border: "1.5px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <Plus size={14} /> Nouveau brief
            </button>
          )}
        </div>

        {/* KPIs pleine largeur */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
          <KpiCard value={rec ? durationLabel : "—"} label="durée de campagne" />
          <KpiCard value={rec ? fmtInt(facesCount) : "—"} label="faces" />
          <KpiCard value={rec ? fmtCompact(impressions) : "—"} label="impressions" />
          <KpiCard value={rec && typeof budget === "number" ? `${fmtInt(budget)} €` : "—"} label="budget" />
        </div>

        {/* Grille : besoin/faces | carte | actions/filtres */}
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr 220px", gap: 16, alignItems: "start" }}>
          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={card()}>
              <div style={{ padding: "16px 18px" }}>
                <h2 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                  Quel est votre besoin de communication ?
                </h2>

                <div ref={threadRef} style={{ maxHeight: 210, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {messages.length === 0 && (
                    <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                      Décrivez votre campagne : enseigne, zone (ville, arrondissement), cible…
                    </p>
                  )}
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                        <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-primary)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                          {highlightArr(m.content)}
                        </p>
                      </div>
                    ) : (
                      <p key={m.id} style={{ margin: 0, fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {m.content}
                      </p>
                    ),
                  )}
                  {loading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: "12.5px" }}>
                      <Dots /> Analyse du brief…
                    </div>
                  )}
                </div>

                {rec && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {criteria.enseigne && <Tag>Enseigne : {criteria.enseigne}</Tag>}
                    {criteria.arrondissement && <Tag>Paris {criteria.arrondissement}e</Tag>}
                    {rec.radius_m && <Tag>Rayon {rec.radius_m} m</Tag>}
                    {criteria.target && <Tag>Cible : {criteria.target}</Tag>}
                    {rec.eligible_count != null && <Tag>{fmtInt(rec.eligible_count)} faces éligibles</Tag>}
                  </div>
                )}

                <div style={{ position: "relative", background: "var(--surface-alt)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px" }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={2}
                    placeholder="Ex. campagne à proximité des magasins Nicolas dans le 15e…"
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--text-primary)", fontSize: "12.5px", fontFamily: "inherit", lineHeight: 1.5 }}
                  />
                  <button
                    onClick={() => send()}
                    disabled={loading || !input.trim()}
                    aria-label="Envoyer"
                    style={{ width: 30, height: 30, minWidth: 30, background: "var(--navy)", border: "none", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", cursor: loading || !input.trim() ? "not-allowed" : "pointer", opacity: loading || !input.trim() ? 0.4 : 1, color: "#fff", marginTop: 1 }}
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
                <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "11px" }}>
                  Entrée pour envoyer · Maj+Entrée = nouvelle ligne
                </p>
                {chatError && (
                  <p style={{ margin: "8px 0 0", color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 10px", fontSize: "12px" }}>
                    {chatError}
                  </p>
                )}
              </div>
            </div>

            {/* Liste des faces (cartes blanches) */}
            {rec && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto", paddingRight: 2 }}>
                {panels.map((p, i) => (
                  <FaceCard key={p.panel_id} num={i + 1} p={p} />
                ))}
              </div>
            )}
          </div>

          {/* CENTER : carte */}
          <div style={{ ...card(), position: "relative", overflow: "hidden" }}>
            {(loading || filtering) && (
              <div style={{ position: "absolute", inset: 0, zIndex: 1100, background: "rgba(255,255,255,0.6)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: "var(--navy)", padding: "8px 16px", borderRadius: 999, boxShadow: "var(--shadow-md)", border: "1px solid var(--border)", fontSize: "13px", fontWeight: 600 }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--navy)", borderTopColor: "transparent", display: "inline-block" }} className="animate-spin" />
                  Mise à jour…
                </div>
              </div>
            )}
            <MapView panels={panels} stores={stores} height={520} showToolbar={false} />
          </div>

          {/* RIGHT : actions + filtres */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={saveExcel} disabled={!plan || exporting} style={navyBtn(!plan || exporting)}>
              <Download size={15} /> {exporting ? "Export…" : "Enregistrer"}
            </button>
            <button onClick={preReserve} disabled={!plan} style={outlineBtn(!plan)}>
              <CalendarCheck size={15} /> Pré-réserver
            </button>
            {note && (
              <p style={{ margin: 0, fontSize: "12px", color: "var(--navy)", background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", boxShadow: "var(--shadow-sm)" }}>
                {note}
              </p>
            )}

            <div style={{ ...card(), overflow: "hidden" }}>
              <div style={{ padding: "13px 15px 11px", borderBottom: "1px solid var(--border)", background: "var(--surface-alt)" }}>
                <h3 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>Filtres</h3>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 13 }}>
                <FilterSelect
                  label="Géographique"
                  value={arrValue}
                  onChange={(v) => applyFilter({ arrondissement: v ? Number(v) : null, city: "Paris" })}
                  options={[{ value: "", label: "Tout Paris" }, ...Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `Paris ${i + 1}e` }))]}
                />
                <FilterSelect
                  label="Distance enseigne"
                  value={enseigneValue}
                  onChange={(v) => applyFilter({ enseigne: v || null })}
                  options={[{ value: "", label: "Aucune enseigne" }, ...filterOptions.enseignes.map((e) => ({ value: e, label: e }))]}
                />
                <FilterSelect
                  label="Rayon"
                  value={distValue}
                  disabled={!enseigneValue}
                  onChange={(v) => applyFilter({ max_distance_m: v ? Number(v) : null })}
                  options={[{ value: "", label: "Rayon auto" }, ...filterOptions.distances_m.map((d) => ({ value: String(d), label: `≤ ${d} m` }))]}
                />
                <FilterSelect
                  label="Segment"
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
                  label="Durée"
                  value={durDaysValue}
                  onChange={(v) => applyFilter({ duration_days: v ? Number(v) : null })}
                  options={[{ value: "", label: "7 jours" }, ...[7, 14, 21, 28].map((d) => ({ value: String(d), label: `${d} jours` }))]}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function card(): React.CSSProperties {
  return {
    background: "var(--surface)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-md)",
  };
}

function navyBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px",
    background: "var(--navy)",
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
    boxShadow: "0 4px 12px rgba(22,40,62,0.28)",
    opacity: disabled ? 0.45 : 1,
  };
}

function outlineBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px",
    background: "var(--surface)",
    color: "var(--navy)",
    border: "1.5px solid var(--border)",
    borderRadius: "var(--radius)",
    fontSize: "13.5px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    boxShadow: "var(--shadow-sm)",
    opacity: disabled ? 0.5 : 1,
  };
}

function KpiCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ ...card(), padding: "16px 20px" }}>
      <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: 3, textTransform: "lowercase" }}>{label}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", background: "rgba(22,40,62,0.07)", border: "1px solid rgba(22,40,62,0.12)", borderRadius: 20, color: "var(--navy)", fontSize: "11.5px", fontWeight: 600 }}>
      {children}
    </span>
  );
}

function FaceCard({ num, p }: { num: number; p: Panel }) {
  return (
    <div style={{ ...card(), padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", minWidth: 0 }}>
          {num}. {p.address || "Panneau"}{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
            — {p.city}
            {p.arrondissement ? ` ${p.arrondissement}e` : ""}
          </span>
        </span>
        {p.distance_m != null && (
          <span style={{ background: "rgba(22,40,62,0.08)", color: "var(--navy)", borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
            {fmtInt(p.distance_m)} m
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: "11.5px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
        {p.nearest_store ? `${p.nearest_store} · ` : ""}
        {fmtInt(p.daily_traffic)} passages/jour
        {typeof p.impressions === "number" ? ` · ≈ ${fmtCompact(p.impressions)} impressions` : ""}
      </p>
      {p.explanation?.trim() && (
        <p style={{ margin: "6px 0 0", fontSize: "11.5px", color: "var(--text-muted)", lineHeight: 1.55 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && (
        <label style={{ color: "var(--text-secondary)", fontSize: "11.5px", fontWeight: 600 }}>{label}</label>
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
        <span key={i} className="animate-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--navy)", opacity: 0.6 }} />
      ))}
    </span>
  );
}

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

function JcdLogo({ className = "h-7 w-auto" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 132 50" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="JCDecaux">
      <path d="M106.917 0L0 0.0690088L0.00614371 2.26165L109.111 2.19107L106.917 0Z" fill="url(#jcd_g0)" />
      <path d="M2.19328 2.26165L2.22744 49.9983L0.0326656 50L7.08859e-06 0.0705773L2.19328 2.26165Z" fill="url(#jcd_g1)" />
      <path d="M29.4021 31.8242C29.4041 34.0879 28.794 37.7837 23.5486 37.7861C20.6159 37.7895 17.76 36.1886 17.7548 32.3488L17.7563 30.8207L21.2532 30.8196L21.2519 31.6074C21.2552 33.3085 21.6744 34.539 23.497 34.5361C25.5405 34.5345 25.538 32.8879 25.5373 31.6537L25.5325 19.7851L29.3949 19.7846L29.4021 31.8242Z" fill="currentColor" />
      <path d="M43.3873 25.6829C43.1411 23.9343 41.4698 22.6059 39.5478 22.6079C36.072 22.611 34.7687 25.5647 34.7727 28.6437C34.7722 31.5726 36.0815 34.5284 39.553 34.5266C41.9168 34.5256 43.247 32.8978 43.5387 30.5846L47.2864 30.5825C46.8936 34.9636 43.864 37.7738 39.5562 37.7755C34.1133 37.7814 30.9077 33.7191 30.9068 28.6464C30.9027 23.4272 34.1005 19.3597 39.5424 19.3554C43.4081 19.3543 46.6606 21.6158 47.1335 25.6791L43.3873 25.6829Z" fill="currentColor" />
      <path d="M52.5248 23.0164L55.2794 23.0183C59.1242 23.0136 60.3563 25.2762 60.3584 28.825C60.3605 32.7155 58.2206 34.0968 55.9793 34.0966L52.5331 34.1008L52.5248 23.0164ZM48.6657 37.3486L56.2537 37.3457C61.6215 37.3429 64.2263 33.55 64.2234 28.4541C64.22 22.6162 60.7958 19.7614 56.242 19.7663L48.6556 19.7703L48.6657 37.3486Z" fill="currentColor" />
      <path d="M68.6583 29.6075C68.709 28.6213 69.347 26.8983 71.5657 26.8955C73.2606 26.8941 74.0247 27.8299 74.3484 29.6038L68.6583 29.6075ZM77.8452 31.816C78.0892 27.902 75.9951 24.2567 71.6593 24.2584C67.7929 24.2661 65.1622 27.1718 65.1638 30.9875C65.1662 34.9282 67.6545 37.6851 71.6683 37.6828C74.5508 37.6806 76.6437 36.4003 77.6248 33.3931L74.5469 33.3947C74.3244 34.1837 73.1939 35.0484 71.7924 35.0468C69.8449 35.0498 68.7606 34.0396 68.6598 31.8227L77.8452 31.816Z" fill="currentColor" />
      <path d="M87.8181 29.0797C87.5964 27.6478 86.6851 26.8842 85.2332 26.8856C82.9889 26.8903 82.2522 29.1547 82.2544 31.0291C82.2558 32.849 82.9726 35.0408 85.1633 35.0378C86.7869 35.0357 87.7242 34.004 87.9443 32.4481L91.317 32.4481C90.8749 35.8223 88.539 37.6687 85.188 37.6725C81.3467 37.6759 78.7595 34.9674 78.7579 31.1517C78.7561 27.1864 81.1173 24.2545 85.2552 24.2511C88.2585 24.2476 91.0172 25.8248 91.2406 29.0733L87.8181 29.0797Z" fill="currentColor" />
      <path d="M100.509 32.3935C100.508 33.1584 100.411 35.3243 97.679 35.3263C96.5451 35.3271 95.5359 35.0065 95.5358 33.7026C95.5351 32.4242 96.5207 32.0507 97.6025 31.8274C98.6852 31.6313 99.9159 31.6048 100.508 31.0896L100.509 32.3935ZM95.9265 28.5071C96.0475 27.1272 96.9097 26.5839 98.2383 26.5828C99.4706 26.5845 100.505 26.8037 100.505 28.304C100.505 29.7345 98.5092 29.6615 96.3692 29.9837C94.2018 30.2804 92.0347 30.9698 92.0377 33.8523C92.0384 36.4626 93.9603 37.6659 96.3743 37.6654C97.9222 37.6646 99.5503 37.2464 100.659 36.0864C100.683 36.5068 100.78 36.924 100.904 37.3165L104.451 37.3142C104.131 36.8012 104.009 35.6413 104.007 34.4843L104.004 27.8594C104 24.8068 100.946 24.2429 98.4091 24.2445C95.554 24.245 92.6229 25.2303 92.4288 28.5073L95.9265 28.5071Z" fill="currentColor" />
      <path d="M117.863 37.3066L114.538 37.3111L114.539 35.5373L114.461 35.5359C113.577 36.9671 112.051 37.6541 110.574 37.6573C106.857 37.6571 105.917 35.5692 105.916 32.4149L105.911 24.5828L109.408 24.5783L109.415 31.7732C109.415 33.8649 110.027 34.9002 111.656 34.8969C113.551 34.8966 114.364 33.8379 114.36 31.2519L114.359 24.5769L117.856 24.5759L117.863 37.3066Z" fill="currentColor" />
      <path d="M122.97 30.6043L118.782 24.5733L122.771 24.572L125.014 27.8957L127.228 24.5715L131.091 24.5677L126.913 30.5298L131.618 37.299L127.631 37.3022L124.969 33.2896L122.311 37.3053L118.397 37.3035L122.97 30.6043Z" fill="currentColor" />
      <defs>
        <linearGradient id="jcd_g0" x1="131.619" y1="25.0003" x2="6.8515" y2="54.2361" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
        <linearGradient id="jcd_g1" x1="53.805" y1="10.2735" x2="53.8137" y2="50.0026" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
