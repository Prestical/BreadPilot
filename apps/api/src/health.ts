import type pg from "pg";

export type CheckStatus = "ok" | "down";
export type OverallStatus = "ok" | "degraded" | "down";

export interface CheckResult {
  status: CheckStatus;
  detail: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: OverallStatus;
  checks: { db: CheckResult; llm: CheckResult; embed: CheckResult; docs?: CheckResult };
  version: string;
  uptimeS: number;
}

export interface HealthDeps {
  checkDb(): Promise<CheckResult>;
  /** Model ids served by the OpenAI-compatible endpoint. Throws if unreachable. */
  listModels(): Promise<string[]>;
  llmModel: string;
  embedModel: string;
  /** Indexed documentation (RAG). Optional so the health endpoint works before RAG is wired. */
  checkDocs?(): Promise<CheckResult>;
}

const TIMEOUT_MS = 2000;

/** Readable message, including Node's AggregateError (e.g. ECONNREFUSED on IPv4 + IPv6), which has an empty message. */
export function errorMessage(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return [...new Set(err.errors.map(errorMessage))].join("; ");
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return err.message || code || err.name;
  }
  return String(err);
}

export function dbCheck(pool: pg.Pool): () => Promise<CheckResult> {
  return async () => {
    const start = performance.now();
    try {
      const { rows } = await pool.query<{ extversion: string | null }>(
        "SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS extversion",
      );
      const latencyMs = Math.round(performance.now() - start);
      const ext = rows[0]?.extversion;
      if (!ext) return { status: "down", detail: "pgvector extension not installed", latencyMs };
      return { status: "ok", detail: `postgres reachable, pgvector ${ext}`, latencyMs };
    } catch (err) {
      return { status: "down", detail: errorMessage(err) };
    }
  };
}

export function openAiModelLister(baseUrl: string): () => Promise<string[]> {
  return async () => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET /models returned HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  };
}

/** Ollama reports untagged models as "name:latest". */
export function hasModel(ids: string[], wanted: string): boolean {
  const withTag = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return ids.some((id) => id === wanted || id === withTag);
}

export async function runHealthChecks(deps: HealthDeps, version: string): Promise<HealthReport> {
  const [db, models, docs] = await Promise.all([
    deps.checkDb(),
    (async () => {
      const start = performance.now();
      try {
        return { ids: await deps.listModels(), latencyMs: Math.round(performance.now() - start) };
      } catch (err) {
        return { error: errorMessage(err) };
      }
    })(),
    deps.checkDocs?.().catch((err): CheckResult => ({ status: "down", detail: errorMessage(err) })),
  ]);

  const modelCheck = (name: string): CheckResult => {
    if ("error" in models) return { status: "down", detail: `LLM endpoint unreachable: ${models.error}` };
    return hasModel(models.ids, name)
      ? { status: "ok", detail: `${name} available`, latencyMs: models.latencyMs }
      : { status: "down", detail: `${name} not pulled (run: ollama pull ${name})`, latencyMs: models.latencyMs };
  };
  const llm = modelCheck(deps.llmModel);
  const embed = modelCheck(deps.embedModel);

  // The DB is required for the app to work; the LLM only blocks project generation.
  const status: OverallStatus =
    db.status === "down" ? "down" : llm.status === "ok" && embed.status === "ok" && docs?.status !== "down" ? "ok" : "degraded";

  const checks: HealthReport["checks"] = { db, llm, embed };
  if (docs) checks.docs = docs;
  return { status, checks, version, uptimeS: Math.round(process.uptime()) };
}
