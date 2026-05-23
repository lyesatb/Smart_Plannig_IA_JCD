"use client";

import { useState, type ReactElement } from "react";
import {
  BarChart3,
  Download,
  Filter,
  CheckCircle2,
  Target,
  ChevronRight,
  TrendingUp,
  Users,
  MapPinned,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";

type Panel = {
  panel_id: string;
  explanation?: string;
};

type DistRow = { label: string; count: number };

export type RecAnalytics = {
  summary?: {
    eligible_panels?: number;
    ineligible_panels?: number;
    scoring_pool?: number;
    pool_internal_count?: number;
    export_excel_rows?: number;
    recommended?: number;
    filtered_panels?: number;
    availability_rate_eligible_pct?: number;
  };
  pipeline?: {
    steps?: { id: string; label: string; count: number; hint?: string }[];
  };
  plan_insights?: {
    selection_rate_pct?: number;
    score_uplift_vs_eligible?: number | null;
    eligible_count?: number;
    score_min?: number | null;
    score_max?: number | null;
    estimated_daily_reach?: number;
    cities_count?: number;
    poi_diversity?: number;
    top_poi?: string | null;
    top_format?: string | null;
    cities_breakdown?: DistRow[];
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
  };
  score_distribution?: {
    eligible?: { bucket: string; count: number }[];
    recommended?: { bucket: string; count: number }[];
  };
  poi_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
  city_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
  format_distribution?: { eligible?: DistRow[]; recommended?: DistRow[] };
};

const TOOLTIP_STYLE = {
  background: "rgba(0,0,0,0.88)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  color: "white",
};

const STEP_ICONS: Record<string, typeof Filter> = {
  filtered: Filter,
  eligible: CheckCircle2,
  plan: Target,
};

export function AnalyticsSection({
  analytics,
  criteria,
  panels,
  apiBase,
}: {
  analytics: RecAnalytics;
  criteria?: Record<string, unknown>;
  panels?: Panel[];
  apiBase: string;
}) {
  const poiData = mergeCompare(analytics.poi_distribution);
  const cityData = mergeCompare(analytics.city_distribution);
  const formatData = mergeCompare(analytics.format_distribution);
  const s = analytics.summary;
  const rat = analytics.selection_rationale;
  const av = analytics.averages;
  const ins = analytics.plan_insights;
  const steps = analytics.pipeline?.steps ?? defaultPipelineSteps(s);
  const scoreCompare = mergeScoreBuckets(
    analytics.score_distribution?.eligible,
    analytics.score_distribution?.recommended,
  );

  const exportCriteria = criteria && Object.keys(criteria).length > 0 ? criteria : { top_k: 12 };
  const maxStep = Math.max(...steps.map((st) => st.count), 1);

  return (
    <div className="glass rounded-3xl p-6 md:p-8 mt-6 analytics-root">
      <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="text-cyan-300 shrink-0" />
            Analyse du plan média
          </h2>
          <p className="text-sm text-gray-400 mt-2 max-w-2xl">
            Synthèse de la sélection : parcours de filtrage, qualité du plan retenu et répartition
            géographique par rapport au brief.
          </p>
        </div>
        <ExportButtons
          apiBase={apiBase}
          criteria={exportCriteria}
          planCount={s?.recommended ?? panels?.length ?? 0}
          eligibleCount={s?.export_excel_rows ?? s?.eligible_panels ?? 0}
          panels={panels}
        />
      </header>

      <section className="analytics-block mb-8">
        <h3 className="analytics-section-title">Parcours de sélection</h3>
        <div className="analytics-funnel">
          {steps.map((step, i) => {
            const Icon = STEP_ICONS[step.id] ?? ChevronRight;
            const widthPct = Math.max(12, Math.round((step.count / maxStep) * 100));
            return (
              <div key={step.id} className="analytics-funnel-step">
                {i > 0 && <ChevronRight className="analytics-funnel-arrow hidden sm:block" size={18} />}
                <div className="analytics-funnel-card">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-cyan-300 shrink-0" />
                    <span className="text-xs font-medium text-gray-300">{step.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-white tabular-nums">
                    {step.count.toLocaleString("fr-FR")}
                  </p>
                  {step.hint && <p className="text-[11px] text-gray-500 mt-1">{step.hint}</p>}
                  <div className="analytics-funnel-bar mt-3" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {ins && (
        <section className="analytics-block mb-8">
          <h3 className="analytics-section-title flex items-center gap-2">
            <TrendingUp size={18} className="text-cyan-300" />
            Performance du plan retenu
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <InsightCard
              label="Part du parc retenue"
              value={`${ins.selection_rate_pct ?? 0} %`}
              hint={`${s?.recommended ?? 0} / ${ins.eligible_count ?? s?.eligible_panels ?? 0} panneaux éligibles`}
              highlight
            />
            <InsightCard
              label="Score vs parc éligible"
              value={
                ins.score_uplift_vs_eligible != null
                  ? `${ins.score_uplift_vs_eligible >= 0 ? "+" : ""}${ins.score_uplift_vs_eligible} pts`
                  : "—"
              }
              hint={
                av?.smart_score?.recommended != null && av?.smart_score?.eligible != null
                  ? `${av.smart_score.recommended} vs ${av.smart_score.eligible} moy. parc`
                  : undefined
              }
            />
            <InsightCard
              label="Reach estimé / jour"
              value={formatCompact(ins.estimated_daily_reach ?? 0)}
              hint="Somme trafic quotidien des panneaux retenus"
            />
            <InsightCard
              label="Plage de scores"
              value={
                ins.score_min != null && ins.score_max != null
                  ? `${ins.score_min} – ${ins.score_max}`
                  : "—"
              }
              hint="Min / max smart_score du plan"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-gray-500 text-xs flex items-center gap-1">
                <MapPinned size={14} /> Couverture
              </p>
              <p className="text-white font-medium mt-1">
                {ins.cities_count ?? 0} ville{(ins.cities_count ?? 0) > 1 ? "s" : ""}
                {(ins.cities_breakdown?.length ?? 0) > 0 && (
                  <span className="text-gray-400 font-normal">
                    {" "}
                    — {(ins.cities_breakdown || []).map((c) => c.label).join(", ")}
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-gray-500 text-xs flex items-center gap-1">
                <Users size={14} /> Diversité POI
              </p>
              <p className="text-white font-medium mt-1">
                {ins.poi_diversity ?? 0} type{(ins.poi_diversity ?? 0) > 1 ? "s" : ""}
                {ins.top_poi && (
                  <span className="text-cyan-200/90"> · dominant : {ins.top_poi}</span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-gray-500 text-xs">Format principal</p>
              <p className="text-white font-medium mt-1">{ins.top_format ?? "—"}</p>
            </div>
          </div>
        </section>
      )}

      {rat && (
        <section className="analytics-block mb-8">
          <h3 className="analytics-section-title">Pourquoi ce plan ?</h3>
          <div className="analytics-rationale">
            <p className="text-cyan-100 font-medium">{rat.title}</p>
            <p className="text-sm text-gray-300 mt-2">{rat.summary}</p>
            <ul className="mt-4 space-y-2">
              {(rat.reasons || []).map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-400">
                  <span className="text-cyan-400 shrink-0">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            {rat.scoring_weights && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-xs text-gray-500 mb-2">Poids du smart_score</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(rat.scoring_weights).map(([k, v]) => (
                    <span
                      key={k}
                      className="text-xs px-2.5 py-1 rounded-full bg-cyan-400/10 text-cyan-200 border border-cyan-300/20"
                    >
                      {k} {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {scoreCompare.some((b) => b.eligible > 0 || b.recommended > 0) && (
        <section className="analytics-block mb-8">
          <h3 className="analytics-section-title">Distribution des smart_score</h3>
          <ChartCard
            title={`Parc éligible (${(s?.eligible_panels ?? 0).toLocaleString("fr-FR")}) vs plan retenu (${s?.recommended ?? 0})`}
            subtitle="Barres grises = tout le parc filtré par le brief · cyan = panneaux affichés sur la carte"
          >
            <BarChart data={scoreCompare} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="bucket" stroke="#9ca3af" fontSize={10} />
              <YAxis stroke="#9ca3af" fontSize={10} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="eligible" name="Parc éligible" fill="#64748b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="recommended" name="Plan retenu" fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </section>
      )}

      <section className="analytics-block">
        <h3 className="analytics-section-title">Répartition POI, villes et formats</h3>
        <p className="text-xs text-gray-500 mb-4">Gris = parc éligible · cyan = plan retenu</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <DistChart title="POI à proximité" data={poiData} />
          <DistChart title="Villes" data={cityData} />
          <DistChart title="Formats DOOH" data={formatData} />
        </div>
      </section>
    </div>
  );
}

function defaultPipelineSteps(s?: RecAnalytics["summary"]) {
  const elig = s?.eligible_panels ?? 0;
  const inel = s?.ineligible_panels ?? 0;
  return [
    {
      id: "filtered",
      label: "Après filtres brief",
      count: s?.filtered_panels ?? elig + inel,
      hint: "Villes & critères",
    },
    { id: "eligible", label: "Parc éligible", count: elig, hint: "Tout le parc scoré" },
    { id: "plan", label: "Plan retenu", count: s?.recommended ?? 0, hint: "Affiché sur la carte" },
  ];
}

function InsightCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 border ${
        highlight ? "border-cyan-300/30 bg-cyan-400/10" : "border-white/10 bg-white/5"
      }`}
    >
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${highlight ? "text-cyan-200" : "text-white"}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactElement;
}) {
  return (
    <div className="analytics-chart-card">
      <p className="text-sm font-medium text-gray-200">{title}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function DistChart({
  title,
  data,
}: {
  title: string;
  data: { label: string; eligible: number; recommended: number }[];
}) {
  return (
    <ChartCard title={title}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
        <XAxis type="number" stroke="#9ca3af" fontSize={10} />
        <YAxis type="category" dataKey="label" stroke="#9ca3af" fontSize={10} width={80} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="eligible" name="Éligible" fill="#64748b" radius={[0, 4, 4, 0]} />
        <Bar dataKey="recommended" name="Retenu" fill="#22d3ee" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartCard>
  );
}

function ExportButtons({
  apiBase,
  criteria,
  planCount,
  eligibleCount,
  panels,
}: {
  apiBase: string;
  criteria?: Record<string, unknown>;
  planCount?: number;
  eligibleCount?: number;
  panels?: Panel[];
}) {
  const [loading, setLoading] = useState<"plan" | "eligible" | null>(null);

  function buildPayload() {
    const recommendation_explanations: Record<string, string> = {};
    for (const p of panels || []) {
      if (p.panel_id && p.explanation?.trim()) {
        recommendation_explanations[p.panel_id] = p.explanation.trim();
      }
    }
    return { ...criteria, recommendation_explanations };
  }

  async function download(scope: "plan" | "eligible") {
    setLoading(scope);
    try {
      const path = scope === "plan" ? "/export/plan-retenu" : "/export/parc-eligible";
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = scope === "plan" ? "plan_retenu_jcdecaux.xlsx" : "parc_eligible_jcdecaux.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <div className="flex flex-col items-stretch lg:items-end gap-2 w-full lg:w-auto">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => download("plan")}
          disabled={busy || (planCount ?? 0) === 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-cyan-400 text-black font-bold text-sm hover:bg-cyan-300 disabled:opacity-60 shrink-0"
        >
          <Download size={18} />
          {loading === "plan"
            ? "Export…"
            : `Plan retenu (${planCount ?? 0} panneaux)`}
        </button>
        <button
          type="button"
          onClick={() => download("eligible")}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-white/20 bg-white/5 text-white font-semibold text-sm hover:bg-white/10 disabled:opacity-60 shrink-0"
        >
          <Download size={18} />
          {loading === "eligible"
            ? "Export…"
            : `Tout le parc (${eligibleCount?.toLocaleString("fr-FR") ?? "—"})`}
        </button>
      </div>
      <p className="text-[11px] text-gray-500 max-w-sm lg:text-right">
        Le <strong className="text-gray-400">plan retenu</strong> = panneaux sur la carte (ex. 14).
        Le graphique « 276 » = panneaux dans la tranche 80–90 du parc, pas le plan.
        <strong className="text-gray-400"> Tout le parc</strong> = export complet après brief.
      </p>
    </div>
  );
}

function formatCompact(n: number) {
  try {
    return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
    return String(n);
  }
}

const SCORE_BUCKETS = ["0-50", "50-60", "60-70", "70-80", "80-90", "90-100"];

function mergeScoreBuckets(
  eligible?: { bucket: string; count: number }[],
  recommended?: { bucket: string; count: number }[],
) {
  const elMap = Object.fromEntries((eligible || []).map((r) => [r.bucket, r.count]));
  const recMap = Object.fromEntries((recommended || []).map((r) => [r.bucket, r.count]));
  return SCORE_BUCKETS.map((bucket) => ({
    bucket,
    eligible: elMap[bucket] || 0,
    recommended: recMap[bucket] || 0,
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
    .sort((a, b) => b.recommended - a.recommended || b.eligible - a.eligible)
    .slice(0, 8);
}
