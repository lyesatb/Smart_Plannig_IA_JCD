'use client';

import { useEffect, useRef, useState } from "react";
import { MapPin, Sparkles, BarChart3, Send, Monitor, Target, Zap, RotateCcw, User, Bot, Info } from "lucide-react";
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
  const [showDetails, setShowDetails] = useState(false);
  const latestUserRef = useRef<HTMLDivElement | null>(null);

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

  // Ancre le défilement sur TON dernier message envoyé (pas sur "le bas de page") :
  // il reste en haut de l'écran même si le plan attaché change de taille en dessous
  // (ancien plan retiré / nouveau plan ajouté) — évite les sauts de scroll.
  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      latestUserRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [messages, loading]);

  // Dernière réponse contenant un plan : une simple discussion ne remplace pas le plan affiché.
  const lastAnswerMessage =
    [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          (m.answer?.recommendation?.results?.length ?? 0) > 0
      ) ?? null;
  const lastAnswer = lastAnswerMessage?.answer ?? null;
  const panels: Panel[] = lastAnswer?.recommendation?.results || [];

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

  // Une fois qu'un message est envoyé, on quitte l'accueil pour la vue conversation
  // (le prompt s'affiche immédiatement, même pendant le premier chargement).
  const showConversation = messages.length > 0;

  // Plan média attaché directement sous la réponse qui l'a généré (comme une pièce jointe
  // dans la discussion), au lieu d'un gros tableau de bord séparé au-dessus du chat.
  function renderPlanAttachment(answer: any) {
    const p: Panel[] = answer?.recommendation?.results || [];
    const dk = buildDynamicKpis(kpis, answer);
    return (
      <div className="mt-3 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={<Monitor />} label={dk.k1Label} value={dk.k1Value} />
          <Kpi icon={<Zap />} label={dk.k2Label} value={dk.k2Value} />
          <Kpi icon={<MapPin />} label={dk.k3Label} value={dk.k3Value} />
          <Kpi icon={<BarChart3 />} label={dk.k4Label} value={dk.k4Value} />
        </div>

        <div className="glass rounded-3xl p-6">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Target className="text-cyan-300" size={18} /> Recommandations IA
          </h3>
          <div className="mb-4 p-4 rounded-2xl bg-cyan-400/10 border border-cyan-300/20 text-cyan-100 text-sm">
            {answer.recommendation.summary}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {p.map((panel) => (
              <div key={panel.panel_id} className="rounded-2xl bg-black/35 border border-white/10 p-4 hover:border-cyan-300/50 transition">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold">{panel.city} — {panel.district}</p>
                    <p className="text-xs text-gray-400">{panel.format} · POI : {panel.poi_nearby}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-cyan-300">{panel.smart_score}</p>
                    <p className="text-xs text-gray-400">score</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 my-4 text-xs">
                  <Mini label="Trafic" value={panel.daily_traffic.toLocaleString()} />
                  <Mini label="CSP+" value={Math.round(panel.audience_csp_plus) + "%"} />
                  <Mini label="Visibilité" value={Math.round(panel.visibility_score) + "%"} />
                </div>
                {panel.explanation?.trim() ? (
                  <p className="text-sm text-gray-300 leading-relaxed">{panel.explanation}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <MapPin className="text-cyan-300" size={18} /> Carte interactive
          </h3>
          <MapView panels={p} />
        </div>

        {answer?.recommendation?.analytics && apiBase && (
          <AnalyticsSection
            apiBase={apiBase}
            analytics={answer.recommendation.analytics}
            criteria={(answer.extracted_criteria || answer.recommendation?.criteria) as Record<string, unknown>}
            panels={p}
          />
        )}

        {showDetails && (
          <div className="text-sm text-gray-300">
            {answer.meta && <EngineMeta meta={answer.meta} />}
            <details className="rounded-xl border border-white/10 bg-black/25 text-xs">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-white font-semibold select-none">
                Critères extraits
              </summary>
              <pre className="bg-black/40 rounded-b-2xl p-4 overflow-auto text-cyan-100">
                {JSON.stringify(answer.extracted_criteria, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    );
  }

  // Écran d'accueil minimaliste façon ChatGPT : juste une barre de saisie centrée.
  if (!showConversation) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#05060a] via-[#101827] to-[#111827] text-white p-6">
        <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center">
          <div className="w-full max-w-2xl">
            <div className="flex items-center justify-center gap-2 text-cyan-300 mb-5">
              <Sparkles size={18} />
              <span className="uppercase tracking-[0.25em] text-[11px]">Smart Planning IA</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold text-center mb-8">
              Quelle campagne veux-tu planifier ?
            </h1>

            <div className="relative rounded-[26px] bg-black/40 border border-white/15 focus-within:border-cyan-400/70 shadow-xl transition">
              <textarea
                className="w-full max-h-48 min-h-[60px] bg-transparent px-5 py-4 pr-14 text-[15px] outline-none resize-none"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Décris ta campagne…"
                autoFocus
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                aria-label="Envoyer"
                className="absolute right-2.5 bottom-2.5 h-9 w-9 rounded-full bg-cyan-400 text-black flex items-center justify-center hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={16} />
              </button>
            </div>

            <p className="text-center text-[11px] text-gray-500 mt-3">
              Entrée pour envoyer · Maj+Entrée = nouvelle ligne
            </p>

            {loading && (
              <div className="flex items-center justify-center gap-2 text-sm text-cyan-200/80 mt-6">
                <Bot size={16} />
                <span className="inline-flex gap-1">
                  <Dot /> <Dot /> <Dot />
                </span>
                <span className="text-gray-400">Analyse en cours…</span>
              </div>
            )}

            {chatError && (
              <p className="mt-4 text-sm text-amber-300 bg-amber-400/10 border border-amber-300/30 rounded-2xl p-3">
                {chatError}
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Vue conversation : la discussion est le contenu principal, visible dès le 1er message.
  // Le plan média (KPIs, recommandations, carte, analyses) s'affiche comme une pièce jointe
  // sous la réponse qui l'a généré — exactement comme une discussion avec un assistant.
  return (
    <main className="min-h-screen overflow-x-hidden bg-gradient-to-br from-[#05060a] via-[#101827] to-[#111827] text-white p-6 pb-44">
      <section className="max-w-5xl mx-auto pt-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-cyan-300">
            <Sparkles size={20} />
            <span className="font-semibold text-white text-lg">Smart Planning IA</span>
          </div>
          <div className="flex items-center gap-4">
            {lastAnswer && (
              <button
                onClick={() => setShowDetails((v) => !v)}
                title="Détails techniques (moteur IA, critères)"
                className={`text-xs flex items-center gap-1 ${
                  showDetails ? "text-cyan-300" : "text-gray-500 hover:text-cyan-300"
                }`}
              >
                <Info size={14} />
              </button>
            )}
            <button
              onClick={resetConversation}
              className="text-xs text-gray-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <RotateCcw size={14} /> Nouvelle discussion
            </button>
          </div>
        </div>

        {/* Fil de discussion — le prompt s'affiche immédiatement, la réponse juste après,
            et le plan (si généré) est attaché directement sous cette réponse. */}
        <div className="space-y-6">
          {messages.map((m, i) => {
            // On ancre toujours sur TON dernier message envoyé (pas sur la réponse), pour
            // que ton prompt reste en haut de l'écran avec sa réponse juste en dessous.
            const isLastUserMessage =
              m.role === "user" && !messages.slice(i + 1).some((x) => x.role === "user");
            if (m.role === "user") {
              return (
                <div key={m.id} ref={isLastUserMessage ? latestUserRef : undefined}>
                  <ChatBubble role="user" content={m.content} />
                </div>
              );
            }
            const hasPlan = (m.answer?.recommendation?.results?.length ?? 0) > 0;
            const isLatestPlan = hasPlan && m === lastAnswerMessage;
            return (
              <div key={m.id}>
                <ChatBubble role="assistant" content={m.content} />
                {isLatestPlan && renderPlanAttachment(m.answer)}
              </div>
            );
          })}

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

        {messages.length > 0 && !loading && (
          <div className="flex flex-wrap gap-2 mt-6">
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

        {chatError && (
          <p className="mt-4 text-sm text-amber-300 bg-amber-400/10 border border-amber-300/30 rounded-2xl p-3">
            {chatError}
          </p>
        )}
      </section>

      {/* Barre de saisie FIXE à l'écran (comme ChatGPT / Copilot) : reste visible même en scrollant */}
      <div
        className="fixed inset-x-0 bottom-0 z-[2000] px-6 pt-3 bg-gradient-to-t from-[#05060a] via-[#05060a]/90 to-transparent"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-[26px] bg-[#0b1220]/95 backdrop-blur border border-white/15 focus-within:border-cyan-400/70 shadow-2xl transition">
            <textarea
              className="w-full max-h-40 min-h-[56px] bg-transparent px-5 py-4 pr-14 text-[15px] outline-none resize-none rounded-[26px]"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Réponds pour affiner (ex. « plutôt à Lyon », « 5 par ville »)…"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              aria-label="Envoyer"
              className="absolute right-2.5 bottom-2.5 h-9 w-9 rounded-full bg-cyan-400 text-black flex items-center justify-center hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-center text-[11px] text-gray-500 mt-2">
            Entrée pour envoyer · Maj+Entrée = nouvelle ligne
          </p>
        </div>
      </div>
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
