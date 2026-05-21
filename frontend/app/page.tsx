'use client';

import { useEffect, useState } from "react";
import { MapPin, Sparkles, BarChart3, Send, Monitor, Target, Zap, Download } from "lucide-react";
import { MapView } from "./components/MapView";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Panel = {
  panel_id: string;
  city: string;
  latitude: number;
  longitude: number;
  district: string;
  format: string;
  daily_traffic: number;
  visibility_score: number;
  audience_csp_plus: number;
  audience_young_active: number;
  poi_nearby: string;
  smart_score?: number;
  explanation?: string;
};

export default function Home() {
  const [kpis, setKpis] = useState<any>(null);
  const [message, setMessage] = useState("Je veux une campagne premium à Paris pour une cible CSP+ autour des gares");
  const [answer, setAnswer] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  useEffect(() => {
    setKpisLoading(true);
    fetch(`${API}/kpis`)
      .then(r => r.json())
      .then(setKpis)
      .finally(() => setKpisLoading(false));
  }, []);

  async function send() {
    setLoading(true);
    setChatError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setAnswer(data);
    } catch (e) {
      const err = e as Error;
      setChatError(
        err.name === "AbortError"
          ? "Délai dépassé (120 s). Groq en limite (tokens/min) — attendez 1 min, puis une seule relance."
          : "Impossible de joindre l’API. Vérifiez que le backend tourne sur le port 8000."
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  const panels: Panel[] = answer?.recommendation?.results || [];
  const dynamicKpis = buildDynamicKpis(kpis, answer);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#05060a] via-[#101827] to-[#111827] text-white p-6">
      <section className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 text-cyan-300 mb-2">
              <Sparkles size={22} />
              <span className="uppercase tracking-[0.25em] text-xs">Retail Media Intelligence</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold">
              Smart Planning IA
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-500">
                JCDecaux x Carrefour x Carmila
              </span>
            </h1>
            <p className="text-gray-300 mt-4 max-w-3xl">
              Plateforme de recommandation intelligente pour sélectionner les meilleurs panneaux DOOH selon la data, l’audience, la disponibilité et les objectifs de campagne.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Kpi icon={<Monitor />} label={dynamicKpis.k1Label} value={answer ? dynamicKpis.k1Value : (kpisLoading ? "…" : dynamicKpis.k1Value)} />
          <Kpi icon={<Zap />} label={dynamicKpis.k2Label} value={answer ? dynamicKpis.k2Value : (kpisLoading ? "…" : dynamicKpis.k2Value)} />
          <Kpi icon={<MapPin />} label={dynamicKpis.k3Label} value={answer ? dynamicKpis.k3Value : (kpisLoading ? "…" : dynamicKpis.k3Value)} />
          <Kpi icon={<BarChart3 />} label={dynamicKpis.k4Label} value={answer ? dynamicKpis.k4Value : (kpisLoading ? "…" : dynamicKpis.k4Value)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass rounded-3xl p-6 lg:col-span-1">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <Sparkles className="text-cyan-300" /> Assistant IA
            </h2>
            <textarea
              className="w-full h-36 rounded-2xl bg-black/40 border border-white/10 p-4 text-sm outline-none focus:border-cyan-400"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              onClick={send}
              disabled={loading}
              className="mt-4 w-full bg-cyan-400 text-black font-bold py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-cyan-300 disabled:opacity-60 disabled:cursor-wait"
            >
              <Send size={18} /> {loading ? "Analyse en cours..." : "Générer le plan média"}
            </button>
            {chatError && (
              <p className="mt-3 text-sm text-amber-300 bg-amber-400/10 border border-amber-300/30 rounded-2xl p-3">
                {chatError}
              </p>
            )}

            {answer && (
              <div className="mt-6 text-sm text-gray-300">
                {answer.meta && (
                  <div className="mb-4 p-3 rounded-xl border border-white/10 bg-black/30 text-xs">
                    <p className="text-white font-semibold mb-1">Moteur IA</p>
                    <p>
                      LLM (Groq) :{" "}
                      <span className={answer.meta.llm_used ? "text-green-400" : "text-amber-400"}>
                        {answer.meta.llm_used ? "actif" : "inactif (fallback)"}
                      </span>
                      {" · "}Brief : {answer.meta.brief_source}
                      {" · "}Panneaux : {answer.meta.recommendation_source}
                      {" · "}Textes panneaux : {answer.meta.explanation_source}
                      {answer.meta.groq_model && (
                        <>
                          {" · "}Modèle :{" "}
                          <span className="text-cyan-200">{answer.meta.groq_model}</span>
                        </>
                      )}
                      {(answer.meta.llm_tls_mode ||
                        typeof answer.meta.llm_ssl_verify === "boolean") && (
                        <>
                          {" · "}Connexion :{" "}
                          <span
                            className={
                              answer.meta.llm_tls_mode === "verified" ||
                              answer.meta.llm_ssl_verify === true
                                ? "text-green-400"
                                : "text-cyan-300"
                            }
                          >
                            {answer.meta.llm_tls_mode === "verified" ||
                            answer.meta.llm_ssl_verify === true
                              ? "TLS vérifié"
                              : "OK réseau Docker"}
                          </span>
                        </>
                      )}
                      {typeof answer.meta.panel_copy_llm === "boolean" && answer.meta.llm_used && (
                        <>
                          {" · "}Rédaction panneaux LLM :{" "}
                          <span
                            className={
                              answer.meta.panel_copy_llm
                                ? "text-green-400"
                                : (answer.meta.panel_explanations_llm_count ?? 0) > 0
                                  ? "text-amber-400"
                                  : "text-amber-400"
                            }
                          >
                            {answer.meta.panel_copy_llm
                              ? "oui (100 % Groq)"
                              : (answer.meta.panel_explanations_llm_count ?? 0) > 0
                                ? "partiel (Groq)"
                                : "non — quota Groq"}
                          </span>
                        </>
                      )}
                      {typeof answer.meta.panel_explanations_llm_count === "number" &&
                        typeof answer.meta.panel_explanations_total === "number" && (
                          <>
                            {" · "}
                            {answer.meta.panel_explanations_llm_count}/
                            {answer.meta.panel_explanations_total} textes LLM
                          </>
                        )}
                    </p>
                    {answer.meta.hint && (
                      <p
                        className={
                          answer.meta.explanation_source === "llm_groq"
                            ? "mt-2 text-gray-400"
                            : "mt-2 text-amber-300/90"
                        }
                      >
                        {answer.meta.hint}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-white font-semibold mb-2">Critères extraits :</p>
                <pre className="bg-black/40 rounded-2xl p-4 overflow-auto text-cyan-100">
                  {JSON.stringify(answer.extracted_criteria, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="glass rounded-3xl p-6 lg:col-span-2">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <Target className="text-cyan-300" /> Recommandations IA
            </h2>

            {!answer && (
              <div className="h-96 flex items-center justify-center text-gray-400 border border-dashed border-white/20 rounded-3xl">
                Lance une demande pour générer un plan média intelligent.
              </div>
            )}

            {answer && (
              <>
                <div className="mb-4 p-4 rounded-2xl bg-cyan-400/10 border border-cyan-300/20 text-cyan-100">
                  {answer.recommendation.summary}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[620px] overflow-auto pr-2">
                  {panels.map((p) => (
                    <div key={p.panel_id} className="rounded-2xl bg-black/35 border border-white/10 p-4 hover:border-cyan-300/50 transition">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold">{p.city} — {p.district}</p>
                          <p className="text-xs text-gray-400">{p.format} · POI : {p.poi_nearby}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-cyan-300">{p.smart_score}</p>
                          <p className="text-xs text-gray-400">score</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 my-4 text-xs">
                        <Mini label="Trafic" value={p.daily_traffic.toLocaleString()} />
                        <Mini label="CSP+" value={Math.round(p.audience_csp_plus) + "%"} />
                        <Mini label="Visibilité" value={Math.round(p.visibility_score) + "%"} />
                      </div>
                      {p.explanation?.trim() ? (
                        <p className="text-sm text-gray-300 leading-relaxed">{p.explanation}</p>
                      ) : (
                        <p className="text-sm text-amber-300/90 italic leading-relaxed">
                          Texte non généré par l&apos;IA (quota Groq ou limite API). Relancez dans quelques minutes —
                          aucun texte modèle n&apos;est affiché à la place.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="glass rounded-3xl p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <MapPin className="text-cyan-300" /> Carte réelle (OpenStreetMap + Leaflet)
          </h2>
          <MapView panels={panels} />
        </div>

        {answer?.recommendation?.analytics && (
          <AnalyticsSection
            analytics={answer.recommendation.analytics}
            criteria={(answer.extracted_criteria || answer.recommendation?.criteria) as Record<string, unknown>}
            panels={panels}
          />
        )}
      </section>
    </main>
  );
}

function Kpi({ icon, label, value }: any) {
  return (
    <div className="glass rounded-3xl p-5">
      <div className="text-cyan-300 mb-3">{icon}</div>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-gray-400 text-sm">{label}</p>
    </div>
  );
}

function AvgMini({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-xl bg-white/5 p-3 border border-white/10">
      <p className="text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-cyan-200">{value != null ? value : "—"}</p>
    </div>
  );
}

function Mini({ label, value }: any) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="text-gray-400">{label}</p>
      <p className="font-semibold text-white">{value}</p>
    </div>
  );
}

type DistRow = { label: string; count: number };
type RecAnalytics = {
  summary?: {
    eligible_panels?: number;
    ineligible_panels?: number;
    scoring_pool?: number;
    recommended?: number;
    availability_rate_eligible_pct?: number;
  };
  averages?: {
    smart_score?: { eligible?: number; pool?: number; recommended?: number };
    visibility?: { eligible?: number; pool?: number; recommended?: number };
  };
  selection_rationale?: {
    title?: string;
    summary?: string;
    reasons?: string[];
    scoring_weights?: Record<string, string>;
    top_k?: number;
    pool_size?: number;
  };
  score_distribution?: {
    eligible?: { bucket: string; count: number }[];
    ineligible?: { bucket: string; count: number }[];
    scoring_pool?: { bucket: string; count: number }[];
    recommended?: { bucket: string; count: number }[];
  };
  poi_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
  city_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
  format_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
};

function ExportPoolExcelButton({
  criteria,
  poolSize,
  panels,
}: {
  criteria?: Record<string, unknown>;
  poolSize?: number;
  panels?: Panel[];
}) {
  const [exporting, setExporting] = useState(false);
  const exportCriteria = criteria && Object.keys(criteria).length > 0 ? criteria : { top_k: 12 };

  async function downloadPoolExcel() {
    setExporting(true);
    try {
      const recommendation_explanations: Record<string, string> = {};
      for (const p of panels || []) {
        if (p.panel_id && p.explanation?.trim()) {
          recommendation_explanations[p.panel_id] = p.explanation.trim();
        }
      }
      const res = await fetch(`${API}/export/scoring-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...exportCriteria, recommendation_explanations }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pool_scoring_jcdecaux.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={downloadPoolExcel}
      disabled={exporting}
      className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-cyan-400 text-black font-bold text-sm hover:bg-cyan-300 disabled:opacity-60 shrink-0"
    >
      <Download size={18} />
      {exporting ? "Export…" : `Télécharger Excel (${poolSize ?? "pool"} panneaux)`}
    </button>
  );
}

function AnalyticsSection({
  analytics,
  criteria,
  panels,
}: {
  analytics: RecAnalytics;
  criteria?: Record<string, unknown>;
  panels?: Panel[];
}) {
  const sd = analytics.score_distribution;
  const eligibleScore = sd?.eligible || [];
  const ineligibleScore = sd?.ineligible || [];
  const poolScore = sd?.scoring_pool || [];
  const recScore = sd?.recommended || [];
  const scoreComparePct = mergeScorePercent(sd);
  const poiData = mergeCompare(analytics.poi_distribution);
  const cityData = mergeCompare(analytics.city_distribution);
  const formatData = mergeCompare(analytics.format_distribution);
  const s = analytics.summary;
  const rat = analytics.selection_rationale;
  const av = analytics.averages;

  const exportCriteria = criteria && Object.keys(criteria).length > 0 ? criteria : { top_k: 12 };

  const tooltipStyle = {
    background: "rgba(0,0,0,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    color: "white",
  };

  return (
    <div className="glass rounded-3xl p-6 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BarChart3 className="text-cyan-300" /> Analytics — parc vs sélection
        </h2>
        <ExportPoolExcelButton criteria={exportCriteria} poolSize={s?.scoring_pool} panels={panels} />
      </div>
      {s && (
        <p className="text-sm text-gray-400 mb-4">
          <span className="text-green-400">{s.eligible_panels?.toLocaleString()} éligibles</span>
          {(s.ineligible_panels ?? 0) > 0 && (
            <span className="text-orange-400"> · {s.ineligible_panels} non éligibles (maintenance)</span>
          )}
          {" · "}pool {s.scoring_pool} · <span className="text-cyan-300">{s.recommended} retenus UI</span>
        </p>
      )}

      {rat && (
        <div className="mb-6 p-4 rounded-2xl bg-cyan-400/5 border border-cyan-300/20">
          <p className="text-cyan-200 font-semibold text-sm mb-2">{rat.title}</p>
          <p className="text-sm text-gray-300 mb-3">{rat.summary}</p>
          <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4 mb-3">
            {(rat.reasons || []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {rat.scoring_weights && (
            <p className="text-xs text-gray-500">
              Poids scoring :{" "}
              {Object.entries(rat.scoring_weights)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            </p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Excel : pool complet ; justification remplie uniquement pour retenu_plan_media = Oui.
          </p>
        </div>
      )}

      {av?.smart_score && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-xs">
          <AvgMini label="Score moyen (éligible)" value={av.smart_score.eligible} />
          <AvgMini label="Score moyen (pool)" value={av.smart_score.pool} />
          <AvgMini label="Score moyen (retenus)" value={av.smart_score.recommended} />
          <AvgMini label="Visibilité moy. (retenus)" value={av.visibility?.recommended} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Scores — parc éligible ({s?.eligible_panels?.toLocaleString() ?? "—"} panneaux)
          </p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eligibleScore} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="bucket" stroke="#9ca3af" fontSize={10} />
                <YAxis stroke="#9ca3af" fontSize={10} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Éligibles" fill="#64748b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {(s?.ineligible_panels ?? 0) > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">
              Scores — non éligibles maintenance ({s?.ineligible_panels} panneaux)
            </p>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ineligibleScore} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="bucket" stroke="#9ca3af" fontSize={10} />
                  <YAxis stroke="#9ca3af" fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Non éligibles" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">Répartition en % — pool scoring vs plan retenu</p>
      <div className="h-[220px] mb-8">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={scoreComparePct} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="bucket" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} unit="%" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pool_pct" name="Pool %" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="rec_pct" name="Retenus %" fill="#22d3ee" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DistChart title="POI" data={poiData} tooltipStyle={tooltipStyle} />
        <DistChart title="Villes" data={cityData} tooltipStyle={tooltipStyle} />
        <DistChart title="Formats" data={formatData} tooltipStyle={tooltipStyle} />
      </div>
    </div>
  );
}

function DistChart({
  title,
  data,
  tooltipStyle,
}: {
  title: string;
  data: { label: string; eligible: number; recommended: number }[];
  tooltipStyle: object;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">{title}</p>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
            <XAxis type="number" stroke="#9ca3af" fontSize={10} />
            <YAxis type="category" dataKey="label" stroke="#9ca3af" fontSize={10} width={72} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="eligible" name="Éligible" fill="#64748b" radius={[0, 4, 4, 0]} />
            <Bar dataKey="recommended" name="Retenu" fill="#22d3ee" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function mergeScorePercent(sd?: RecAnalytics["score_distribution"]) {
  const pool = sd?.scoring_pool || [];
  const rec = sd?.recommended || [];
  const totalP = pool.reduce((a, b) => a + b.count, 0) || 1;
  const totalR = rec.reduce((a, b) => a + b.count, 0) || 1;
  return pool.map((p, i) => ({
    bucket: p.bucket,
    pool_pct: Math.round((p.count / totalP) * 1000) / 10,
    rec_pct: Math.round(((rec[i]?.count ?? 0) / totalR) * 1000) / 10,
  }));
}

function mergeCompare(dist?: { eligible?: DistRow[]; recommended?: DistRow[] }) {
  const labels = new Set<string>();
  (dist?.eligible || []).forEach((r) => labels.add(r.label));
  (dist?.recommended || []).forEach((r) => labels.add(r.label));
  const elMap = Object.fromEntries((dist?.eligible || []).map((r) => [r.label, r.count]));
  const recMap = Object.fromEntries((dist?.recommended || []).map((r) => [r.label, r.count]));
  return Array.from(labels)
    .map((label) => ({
      label,
      eligible: elMap[label] || 0,
      recommended: recMap[label] || 0,
    }))
    .sort((a, b) => b.eligible - a.eligible)
    .slice(0, 8);
}

function buildDynamicKpis(globalKpis: any, answer: any) {
  const rec = answer?.recommendation;
  if (rec) {
    const panels = (rec.results || []) as Panel[];
    const avg = typeof rec.average_score === "number" ? rec.average_score : average(panels.map((p) => p.smart_score ?? 0));
    const reach = typeof rec.estimated_daily_reach === "number" ? rec.estimated_daily_reach : sum(panels.map((p) => p.daily_traffic ?? 0));
    const cityCount = new Set(panels.map((p) => p.city)).size;
    const poiDiversity = new Set(panels.map((p) => p.poi_nearby)).size;
    const topK = answer?.extracted_criteria?.top_k;

    return {
      k1Label: topK ? `Panneaux (top ${topK})` : "Panneaux recommandés",
      k1Value: String(panels.length),
      k2Label: "Score moyen",
      k2Value: isFiniteNumber(avg) ? avg.toFixed(1) : "—",
      k3Label: "Villes couvertes",
      k3Value: String(cityCount),
      k4Label: "Reach (proxy trafic/j)",
      k4Value: isFiniteNumber(reach) ? formatCompact(reach) : "—",
    };
  }

  return {
    k1Label: "Panneaux (dataset)",
    k1Value: globalKpis?.total_panels ? Number(globalKpis.total_panels).toLocaleString() : "—",
    k2Label: "Disponibles",
    k2Value: globalKpis?.available_panels ? Number(globalKpis.available_panels).toLocaleString() : "—",
    k3Label: "Villes",
    k3Value: globalKpis?.cities ? String(globalKpis.cities) : "—",
    k4Label: "Trafic quotidien (total)",
    k4Value: globalKpis?.total_daily_traffic ? formatCompact(Number(globalKpis.total_daily_traffic)) : "—",
  };
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function average(nums: number[]) {
  if (nums.length === 0) return 0;
  return sum(nums) / nums.length;
}

function isFiniteNumber(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function formatCompact(n: number) {
  // fr-FR compact works well in modern browsers; fallback to basic formatting
  try {
    return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(n);
  }
}
