'use client';

import { useEffect, useRef, useState } from "react";
import { MapPin, Sparkles, BarChart3, Send, Monitor, Target, Zap, RotateCcw, User, Bot } from "lucide-react";
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: any;
};

const STARTER_PROMPTS = [
  "Je veux une campagne premium à Paris pour une cible CSP+ autour des gares",
  "Trouve-moi les meilleurs panneaux digitaux à Lyon pour une campagne food premium",
  "Je veux maximiser la couverture à Marseille pour une campagne jeunes actifs",
];

const FOLLOWUP_PROMPTS = [
  "Plutôt à Lyon finalement",
  "Augmente le budget à 300k",
  "Je veux plus de panneaux",
  "Cible jeunes actifs à la place",
];

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function Home() {
  const [kpis, setKpis] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(STARTER_PROMPTS[0]);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [apiBase, setApiBase] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // Dernière réponse contenant un plan : une simple discussion ne remplace pas le plan affiché.
  const lastAnswer =
    [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          (m.answer?.recommendation?.results?.length ?? 0) > 0
      )?.answer ?? null;
  const panels: Panel[] = lastAnswer?.recommendation?.results || [];
  const dynamicKpis = buildDynamicKpis(kpis, lastAnswer);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    if (!apiBase) {
      setChatError(
        "API non configurée. Backend local attendu sur http://localhost:8000 (lancez uvicorn), ou définissez API_URL."
      );
      return;
    }

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const priorCriteria = lastAnswer?.extracted_criteria ?? null;

    setMessages((prev) => [...prev, { id: newId(), role: "user", content }]);
    setInput("");
    setLoading(true);
    setChatError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history, prior_criteria: priorCriteria }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: data.assistant_message || "Plan média mis à jour.",
          answer: data,
        },
      ]);
    } catch (e) {
      const err = e as Error;
      setChatError(
        err.name === "AbortError"
          ? "Délai dépassé (5 min). Relancez une fois après 30 s — le plan partiel peut déjà s'afficher."
          : `Impossible de joindre l'API (${apiBase}). Vérifiez que le backend tourne (uvicorn) et ALLOWED_ORIGINS.`
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  function resetConversation() {
    setMessages([]);
    setChatError(null);
    setInput(STARTER_PROMPTS[0]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const showDashboard = !!lastAnswer;

  const chatPanel = (
    <div className="glass rounded-3xl p-6 flex flex-col w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="text-cyan-300" /> Assistant IA
        </h2>
        {messages.length > 0 && (
          <button
            onClick={resetConversation}
            className="text-xs text-gray-400 hover:text-cyan-300 flex items-center gap-1"
          >
            <RotateCcw size={14} /> Nouvelle discussion
          </button>
        )}
      </div>

      {messages.length > 0 && (
        <div
          ref={threadRef}
          className="flex-1 overflow-auto space-y-3 mb-4 pr-1 min-h-[160px] max-h-[440px]"
        >
          {messages.map((m) => (
            <ChatBubble key={m.id} role={m.role} content={m.content} />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-cyan-200/80">
              <Bot size={16} className="shrink-0" />
              <span className="inline-flex gap-1">
                <Dot /> <Dot /> <Dot />
              </span>
              <span className="text-gray-400">Analyse en cours…</span>
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="text-sm text-gray-400 space-y-4 mb-4">
          <p className="leading-relaxed">
            Décris ta campagne en langage naturel. Je génère un plan média, puis on l'affine
            ensemble : tu peux répondre pour changer la ville, le budget, le POI, la cible ou le
            nombre de panneaux (« 5 par ville »…).
          </p>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Exemples</p>
            {STARTER_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                className="block w-full text-left text-sm rounded-2xl border border-white/10 bg-black/30 px-3 py-2 hover:border-cyan-300/50 hover:text-white transition"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && !loading && (
        <div className="flex flex-wrap gap-2 mb-3">
          {FOLLOWUP_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              className="text-xs rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-gray-300 hover:border-cyan-300/50 hover:text-white transition"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-black/40 border border-white/10 focus-within:border-cyan-400 transition">
        <textarea
          className="w-full h-24 rounded-2xl bg-transparent p-3 text-sm outline-none resize-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            messages.length === 0
              ? "Ex. Campagne premium à Paris, cible CSP+, autour des gares…"
              : "Réponds pour affiner (ex. « plutôt à Lyon », « 5 par ville »)…"
          }
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <span className="text-[11px] text-gray-500">Entrée pour envoyer · Maj+Entrée = nouvelle ligne</span>
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="bg-cyan-400 text-black font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-cyan-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={16} /> {loading ? "…" : "Envoyer"}
          </button>
        </div>
      </div>

      {chatError && (
        <p className="mt-3 text-sm text-amber-300 bg-amber-400/10 border border-amber-300/30 rounded-2xl p-3">
          {chatError}
        </p>
      )}

      {lastAnswer && (
        <div className="mt-6 text-sm text-gray-300">
          {lastAnswer.meta && <EngineMeta meta={lastAnswer.meta} />}
          <details className="rounded-xl border border-white/10 bg-black/25 text-xs">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-white font-semibold select-none">
              Critères extraits
            </summary>
            <pre className="bg-black/40 rounded-b-2xl p-4 overflow-auto text-cyan-100">
              {JSON.stringify(lastAnswer.extracted_criteria, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );

  const recommendationsPanel = (
    <div className="glass rounded-3xl p-6 h-full">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
        <Target className="text-cyan-300" /> Recommandations IA
      </h2>

      {!lastAnswer && (
        <div className="h-96 flex items-center justify-center text-gray-400 border border-dashed border-white/20 rounded-3xl text-center px-6">
          {loading ? "Génération du plan média en cours…" : "Le plan média s'affichera ici."}
        </div>
      )}

      {lastAnswer && (
        <>
          <div className="mb-4 p-4 rounded-2xl bg-cyan-400/10 border border-cyan-300/20 text-cyan-100">
            {lastAnswer.recommendation.summary}
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
  );

  // Écran d'accueil façon ChatGPT : uniquement le chat, centré, tant qu'aucun plan n'existe.
  if (!showDashboard) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#05060a] via-[#101827] to-[#111827] text-white p-6">
        <section className="max-w-3xl mx-auto min-h-[calc(100vh-3rem)] flex flex-col justify-center gap-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 text-cyan-300 mb-3">
              <Sparkles size={22} />
              <span className="uppercase tracking-[0.25em] text-xs">Retail Media Intelligence</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold">
              Smart Planning IA
            </h1>
            <p className="text-gray-300 mt-4 max-w-2xl mx-auto">
              Décris ta campagne en langage naturel : l'assistant IA génère un plan média DOOH,
              puis tu l'affines en discutant. Le plan et la carte apparaissent dès ta première demande.
            </p>
          </div>
          {chatPanel}
        </section>
      </main>
    );
  }

  // Tableau de bord complet, une fois qu'un plan est généré.
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#05060a] via-[#101827] to-[#111827] text-white p-6">
      <section className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Sparkles className="text-cyan-300" size={26} />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">Smart Planning IA</h1>
              <p className="text-[11px] text-gray-400 uppercase tracking-[0.2em]">Retail Media Intelligence</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Kpi icon={<Monitor />} label={dynamicKpis.k1Label} value={dynamicKpis.k1Value} />
          <Kpi icon={<Zap />} label={dynamicKpis.k2Label} value={dynamicKpis.k2Value} />
          <Kpi icon={<MapPin />} label={dynamicKpis.k3Label} value={dynamicKpis.k3Value} />
          <Kpi icon={<BarChart3 />} label={dynamicKpis.k4Label} value={dynamicKpis.k4Value} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">{chatPanel}</div>
          <div className="lg:col-span-2">{recommendationsPanel}</div>
        </div>

        <div className="glass rounded-3xl p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <MapPin className="text-cyan-300" /> Carte interactive
          </h2>
          <MapView panels={panels} />
        </div>

        {lastAnswer?.recommendation?.analytics && apiBase && (
          <AnalyticsSection
            apiBase={apiBase}
            analytics={lastAnswer.recommendation.analytics}
            criteria={(lastAnswer.extracted_criteria || lastAnswer.recommendation?.criteria) as Record<string, unknown>}
            panels={panels}
          />
        )}
      </section>
    </main>
  );
}

function ChatBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-cyan-400 text-black" : "bg-white/10 text-cyan-200"
        }`}
      >
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-cyan-400/15 border border-cyan-300/25 text-cyan-50"
            : "bg-black/35 border border-white/10 text-gray-200"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80 animate-pulse" />;
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
