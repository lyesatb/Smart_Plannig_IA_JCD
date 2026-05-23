"use client";

import { ChevronDown } from "lucide-react";

type Meta = {
  llm_used?: boolean;
  brief_source?: string;
  recommendation_source?: string;
  explanation_source?: string;
  groq_model?: string;
  panel_copy_model?: string;
  groq_model_fast?: string;
  groq_routing?: { reasoning_final?: string };
  groq_api_calls?: number;
  groq_rate_limit_hits?: number;
  llm_tls_mode?: string;
  llm_ssl_verify?: boolean;
  panel_copy_llm?: boolean;
  panel_explanations_llm_count?: number;
  panel_explanations_total?: number;
  latency_note?: string;
  hint?: string;
  duration_total_sec?: number;
};

export function EngineMeta({ meta }: { meta: Meta }) {
  const model =
    meta.panel_copy_model ||
    meta.groq_model ||
    meta.groq_routing?.reasoning_final ||
    meta.groq_model_fast ||
    "—";
  const llmCount = meta.panel_explanations_llm_count;
  const llmTotal = meta.panel_explanations_total;
  const rateHits = meta.groq_rate_limit_hits ?? 0;
  const ok = meta.explanation_source === "llm_groq";
  const partial = meta.explanation_source === "llm_groq_partial";

  const statusLabel = !meta.llm_used
    ? "LLM inactif"
    : ok
      ? "Plan OK"
      : partial
        ? "Plan partiel"
        : "Fallback règles";

  const statusClass = !meta.llm_used
    ? "text-amber-400"
    : ok
      ? "text-green-400"
      : "text-amber-400";

  return (
    <details className="mb-4 rounded-xl border border-white/10 bg-black/25 text-xs group">
      <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between gap-2 select-none">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`font-medium shrink-0 ${statusClass}`}>{statusLabel}</span>
          <span className="text-gray-500 truncate">
            {typeof llmCount === "number" && typeof llmTotal === "number"
              ? `${llmCount}/${llmTotal} textes`
              : ""}
            {meta.duration_total_sec != null ? ` · ~${meta.duration_total_sec}s` : ""}
            {typeof meta.groq_api_calls === "number" ? ` · ${meta.groq_api_calls} appels Groq` : ""}
            {rateHits > 0 ? (
              <span className="text-orange-300"> · {rateHits} limite(s) 429</span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="text-gray-500 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="px-3 pb-3 pt-0 border-t border-white/5 text-gray-400 space-y-2">
        <p>
          <span className="text-gray-500">Groq :</span>{" "}
          <span className={meta.llm_used ? "text-green-400" : "text-amber-400"}>
            {meta.llm_used ? "actif" : "inactif"}
          </span>
          {" · "}
          <span className="text-cyan-200/90">{model}</span>
        </p>
        <p>
          Brief {meta.brief_source} · scoring {meta.recommendation_source} · textes{" "}
          {meta.explanation_source}
        </p>
        {meta.panel_copy_llm != null && meta.llm_used && (
          <p>
            Rédaction panneaux :{" "}
            <span className={meta.panel_copy_llm ? "text-green-400" : "text-amber-400"}>
              {meta.panel_copy_llm ? "100 % Groq" : "partiel / règles"}
            </span>
          </p>
        )}
        {(meta.llm_tls_mode || typeof meta.llm_ssl_verify === "boolean") && (
          <p>
            Connexion :{" "}
            {meta.llm_tls_mode === "verified" || meta.llm_ssl_verify
              ? "TLS vérifié"
              : "OK réseau Docker"}
          </p>
        )}
        {meta.latency_note && <p className="text-gray-500">{meta.latency_note}</p>}
        {meta.hint && (
          <p className={ok ? "text-gray-500" : "text-amber-300/90"}>{meta.hint}</p>
        )}
        {rateHits > 0 && (
          <p className="text-orange-300/90">
            Quota Groq touché ({rateHits}× 429). Attendez 1–2 min avant une nouvelle génération.
          </p>
        )}
        <p className="text-[11px] text-gray-600">
          Détail technique (dev) — cliquez pour replier. N&apos;impacte pas le plan média.
        </p>
      </div>
    </details>
  );
}
