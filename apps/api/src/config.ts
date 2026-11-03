import { resolve } from "node:path";
import { z } from "zod";
import { REASONING_EFFORTS } from "./agent/llm";

const EnvSchema = z.object({
  /** Where the encrypted database (data.enc) lives. The desktop app passes its own app-data folder. */
  DATA_DIR: z.string().default(resolve(process.cwd(), "../../.local/data")),
  LLM_BASE_URL: z.string().url().default("http://localhost:11434/v1"),
  LLM_MODEL: z.string().min(1).default("qwen3:4b-instruct-2507-q4_K_M"),
  LLM_NUM_CTX: z.coerce.number().int().positive().default(16384),
  /** "ollama" = native /api/chat (JSON-schema format + num_ctx); "openai" = /v1/chat/completions. */
  LLM_API: z.enum(["ollama", "openai"]).default("ollama"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /** Optional cloud model. Empty key = only the local model is offered. Embeddings always stay local. */
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-luna"),
  /** gpt-6-luna is a reasoning model; "low" keeps it fast and cheap for these short tasks. */
  OPENAI_REASONING_EFFORT: z.enum(REASONING_EFFORTS).default("low"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  EMBED_MODEL: z.string().min(1).default("nomic-embed-text"),
  /** Port of the development API (npm run dev:api); the desktop app picks a free one. */
  API_PORT: z.coerce.number().int().positive().default(3000),
  /** The web build to serve (apps/web/dist). Empty = API only (Vite serves the page in development). */
  WEB_DIR: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MIGRATIONS_DIR: z.string().default(resolve(process.cwd(), "../../db/migrations")),
  /** Repo root: docs/hardware/** and data/boards/*.pinout.generated.md are indexed from here. */
  REPO_DIR: z.string().default(resolve(process.cwd(), "../..")),
  /** Index new/changed docs in the background when the API starts. */
  RAG_AUTO_INGEST: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example`);
  }
  return parsed.data;
}
