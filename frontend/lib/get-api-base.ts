import { normalizeApiUrl } from "./normalize-api-url";

let cached: string | null = null;

export async function getApiBase(): Promise<string> {
  if (cached) return cached;

  const fromBuild = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
  if (fromBuild && !fromBuild.includes("localhost")) {
    cached = fromBuild;
    return cached;
  }

  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { apiUrl?: string | null };
      const normalized = normalizeApiUrl(data.apiUrl);
      if (normalized) {
        cached = normalized;
        return cached;
      }
    }
  } catch {
    // ignore
  }

  return fromBuild || "http://localhost:8000";
}
