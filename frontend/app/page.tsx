'use client';

import { useEffect, useState } from "react";
import { MapPin, Sparkles, BarChart3, Send, Monitor, Target, Zap } from "lucide-react";

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

  useEffect(() => {
    fetch(`${API}/kpis`).then(r => r.json()).then(setKpis).catch(() => {});
  }, []);

  async function send() {
    setLoading(true);
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    setAnswer(data);
    setLoading(false);
  }

  const panels: Panel[] = answer?.recommendation?.results || [];

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
          <Kpi icon={<Monitor />} label="Panneaux simulés" value={kpis?.total_panels?.toLocaleString() || "10 000"} />
          <Kpi icon={<Zap />} label="Disponibles" value={kpis?.available_panels?.toLocaleString() || "..."} />
          <Kpi icon={<MapPin />} label="Villes" value={kpis?.cities || "7"} />
          <Kpi icon={<BarChart3 />} label="Trafic quotidien" value={kpis?.total_daily_traffic ? Math.round(kpis.total_daily_traffic/1000000)+"M" : "..."} />
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
            <button onClick={send} className="mt-4 w-full bg-cyan-400 text-black font-bold py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-cyan-300">
              <Send size={18} /> {loading ? "Analyse en cours..." : "Générer le plan média"}
            </button>

            {answer && (
              <div className="mt-6 text-sm text-gray-300">
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
                      <p className="text-sm text-gray-300">{p.explanation}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="glass rounded-3xl p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><MapPin className="text-cyan-300" /> Carte simulée des panneaux recommandés</h2>
          <div className="relative h-[420px] rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 border border-white/10">
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: "radial-gradient(circle at 20% 20%, #22d3ee 0, transparent 20%), radial-gradient(circle at 80% 60%, #3b82f6 0, transparent 25%)"}} />
            {panels.slice(0, 20).map((p, idx) => (
              <div
                key={p.panel_id}
                className="absolute w-4 h-4 rounded-full bg-cyan-300 shadow-lg shadow-cyan-400/50 border border-white"
                style={{
                  left: `${10 + (idx * 37) % 80}%`,
                  top: `${15 + (idx * 23) % 70}%`
                }}
                title={`${p.city} - score ${p.smart_score}`}
              />
            ))}
            <div className="absolute bottom-4 left-4 bg-black/60 rounded-2xl p-4 text-sm text-gray-200">
              Simulation visuelle : intégrer Mapbox pour la version industrialisée.
            </div>
          </div>
        </div>
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
