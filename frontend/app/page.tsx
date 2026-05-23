'use client';

import { useEffect, useState } from "react";
import { MapPin, Sparkles, BarChart3, Send, Monitor, Target, Zap } from "lucide-react";
import dynamic from "next/dynamic";

const MapView = dynamic(
  () => import("./components/MapView").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[420px] rounded-3xl bg-black/20 animate-pulse" /> },
);
import { AnalyticsSection } from "./components/AnalyticsSection";
import { EngineMeta } from "./components/EngineMeta";
import { getApiBase } from "../lib/get-api-base";

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
  const [apiBase, setApiBase] = useState<string | null>(null);

  useEffect(() => {
    getApiBase().then(setApiBase);
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    setKpisLoading(true);
    fetch(`${apiBase}/kpis`)
      .then((r) => r.json())
      .then(setKpis)
      .catch(() => setKpis(null))
      .finally(() => setKpisLoading(false));
  }, [apiBase]);

  async function send() {
    if (!apiBase) {
      setChatError(
        "API non configurée. Sur Vercel : variable API_URL = URL Railway (https://...), puis Redeploy."
      );
      return;
    }
    setLoading(true);
    setChatError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const res = await fetch(`${apiBase}/chat`, {
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
          ? "Délai dépassé (5 min). Relancez une fois après 30 s — le plan partiel peut déjà s’afficher si la requête a répondu."
          : `Impossible de joindre l’API (${apiBase}). Vercel → API_URL = URL Railway https://… puis Redeploy. Railway → ALLOWED_ORIGINS = ton URL Vercel.`
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
                {answer.meta && <EngineMeta meta={answer.meta} />}
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
                      ) : null}
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
          {apiBase && (
          <AnalyticsSection
            apiBase={apiBase}
            analytics={answer.recommendation.analytics}
            criteria={(answer.extracted_criteria || answer.recommendation?.criteria) as Record<string, unknown>}
            panels={panels}
          />
          )}
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

function Mini({ label, value }: any) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="text-gray-400">{label}</p>
      <p className="font-semibold text-white">{value}</p>
    </div>
  );
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
