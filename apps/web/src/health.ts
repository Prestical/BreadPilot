// Mirrors the shape returned by GET /api/health (apps/api/src/health.ts).
export type Status = "ok" | "degraded" | "down";

export interface Check {
  status: "ok" | "down";
  detail: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: Status;
  checks: { db: Check; llm: Check; embed: Check; docs?: Check };
  version: string;
  circuitCore: string;
  uptimeS: number;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  const res = await fetch("/api/health", { signal });
  // 503 still carries a valid report body (database down).
  if (!res.ok && res.status !== 503) throw new Error(`API returned HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as Partial<HealthReport> | null;
  // Any other 503 (a proxy, an API still starting) has no checks; reading them would crash the page.
  if (!body?.checks?.db || !body.checks.llm || !body.checks.embed) throw new Error(`API returned HTTP ${res.status}`);
  return body as HealthReport;
}
