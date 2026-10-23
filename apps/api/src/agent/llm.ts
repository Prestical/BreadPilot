// LLM client for structured (JSON-schema constrained) output.
// "ollama": native /api/chat with `format` = JSON Schema (constrained decoding) and per-request
//           num_ctx. Default, because the OpenAI-compatible endpoint ignores num_ctx.
// "openai": /v1/chat/completions with response_format json_schema (Docker Model Runner, others).
//           With `reasoningEffort` it talks to OpenAI's own reasoning models (e.g. gpt-6-luna):
//           API key, strict schema, reasoning_effort, max_completion_tokens, no temperature.
// The reply is always re-validated with zod; one retry tells the model what was wrong.

import * as z from "zod/v4";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Tokens a call used, as the model server reports them (summed over the JSON retry). */
export interface TokenUsage {
  input: number;
  /** Everything generated, including a reasoning model's hidden thinking. */
  output: number;
  /** The hidden thinking part of `output` (OpenAI reasoning models; 0 otherwise). */
  reasoning: number;
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, reasoning: 0 };

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input + b.input, output: a.output + b.output, reasoning: a.reasoning + b.reasoning });

export interface LlmResult<T> {
  data: T;
  ms: number;
  attempts: number;
  usage: TokenUsage;
}

export interface LlmClient {
  readonly model: string;
  json<T>(schema: z.ZodType<T>, messages: ChatMessage[], opts?: LlmCallOptions): Promise<LlmResult<T>>;
}

export interface LlmCallOptions {
  temperature?: number;
  /** Output cap (Ollama num_predict / OpenAI max_tokens), so a looping model stops early. */
  maxTokens?: number;
  /** Per-call timeout; the smaller of this and the client's timeout is used. */
  timeoutMs?: number;
  /** Cancels the request (the user pressed Stop). */
  signal?: AbortSignal;
}

export class LlmError extends Error {
  /** Tokens already spent before the call failed (e.g. two invalid replies). */
  usage: TokenUsage = NO_USAGE;
}

export interface LlmConfig {
  api: "ollama" | "openai";
  baseUrl: string;
  model: string;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
  /** Sent as a Bearer token (OpenAI's API). */
  apiKey?: string;
  /** OpenAI reasoning models only ("openai" api): sent as reasoning_effort; turns on the strict schema. */
  reasoningEffort?: ReasoningEffort;
  fetchImpl?: typeof fetch;
}

export const REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * A reasoning model's hidden thinking counts against max_completion_tokens, so the stage's answer
 * cap gets this much room on top; otherwise a long think leaves an empty or cut-off answer.
 */
export const REASONING_HEADROOM = 8000;

// Upper bounds and patterns expand into large grammars; lower bounds (minLength 1, minItems 1)
// are cheap and stop empty answers like an empty "goal".
const GRAMMAR_HEAVY = new Set(["maxLength", "pattern", "maxItems", "maximum", "exclusiveMaximum", "$schema"]);

/**
 * The schema sent for constrained decoding keeps structure, types, enums, required fields and
 * lower bounds, but drops upper bounds and patterns: llama.cpp expands e.g. maxLength 8000 into
 * repeated grammar rules, which is slow or fails. Sizes are normalized in code afterwards.
 */
export function grammarSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(grammarSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !GRAMMAR_HEAVY.has(k)).map(([k, v]) => [k, grammarSchema(v)]));
}

/**
 * OpenAI's strict structured outputs: every object lists all its properties as required and allows no
 * others, so optional fields become nullable (nulls are dropped again before zod, see dropNulls).
 * minLength isn't a supported keyword there; zod still checks it afterwards.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s = Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "minLength").map(([k, v]) => [k, strictSchema(v)])) as Record<string, unknown>;
  const props = s.properties as Record<string, Record<string, unknown>> | undefined;
  if (s.type !== "object" || !props) return s;
  const required = new Set((s.required as string[] | undefined) ?? []);
  const nullable = (p: Record<string, unknown>) => ({
    ...p,
    type: [p.type, "null"],
    ...(Array.isArray(p.enum) ? { enum: [...p.enum, null] } : {}),
  });
  return {
    ...s,
    properties: Object.fromEntries(Object.entries(props).map(([k, p]) => [k, required.has(k) ? p : nullable(p)])),
    required: Object.keys(props),
    additionalProperties: false,
  };
}

/** Removes null-valued object keys (the strict schema's stand-in for "left out"). */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]));
}

const root = (baseUrl: string) => baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

export function createLlm(cfg: LlmConfig): LlmClient {
  const fetchImpl = cfg.fetchImpl ?? fetch;

  const call = async (schema: object, messages: ChatMessage[], temperature: number, maxTokens?: number, timeoutMs = cfg.timeoutMs, stop?: AbortSignal): Promise<{ content: string; usage: TokenUsage }> => {
    const ollama = cfg.api === "ollama";
    const url = ollama ? `${root(cfg.baseUrl)}/api/chat` : `${root(cfg.baseUrl)}/v1/chat/completions`;
    const reasoning = !ollama && cfg.reasoningEffort !== undefined;
    const body = ollama
      ? { model: cfg.model, messages, stream: false, format: schema, keep_alive: "15m", options: { num_ctx: cfg.numCtx, temperature, ...(maxTokens ? { num_predict: maxTokens } : {}) } }
      : reasoning
        ? {
            model: cfg.model,
            messages,
            reasoning_effort: cfg.reasoningEffort,
            ...(maxTokens ? { max_completion_tokens: maxTokens + REASONING_HEADROOM } : {}),
            response_format: { type: "json_schema", json_schema: { name: "output", schema: strictSchema(schema), strict: true } },
          }
        : { model: cfg.model, messages, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}), response_format: { type: "json_schema", json_schema: { name: "output", schema, strict: true } } };
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: stop ? AbortSignal.any([AbortSignal.timeout(Math.min(cfg.timeoutMs, timeoutMs)), stop]) : AbortSignal.timeout(Math.min(cfg.timeoutMs, timeoutMs)),
      });
    } catch (err) {
      throw new LlmError(`Can't reach the language model at ${url}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (cfg.apiKey && res.status === 401) throw new LlmError("OpenAI rejected the API key (HTTP 401). Check OPENAI_API_KEY in .env.");
      if (cfg.apiKey && res.status === 429) throw new LlmError(`OpenAI says the key is out of credit or over its rate limit (HTTP 429): ${text}`);
      throw new LlmError(`Language model returned HTTP ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    const usage: TokenUsage = ollama
      ? { input: json.prompt_eval_count ?? 0, output: json.eval_count ?? 0, reasoning: 0 }
      : { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0, reasoning: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0 };
    const content = ollama ? json.message?.content : json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      const err = new LlmError("Language model reply had no content");
      err.usage = usage;
      throw err;
    }
    return { content, usage };
  };

  return {
    model: cfg.model,
    async json<T>(schema: z.ZodType<T>, messages: ChatMessage[], opts: LlmCallOptions = {}): Promise<LlmResult<T>> {
      const jsonSchema = grammarSchema(z.toJSONSchema(schema)) as object;
      const start = performance.now();
      const convo = [...messages];
      let lastError = "";
      let usage = NO_USAGE;
      const failed = (err: unknown) => {
        if (err instanceof LlmError) err.usage = addUsage(usage, err.usage);
        return err;
      };
      for (let attempt = 1; attempt <= 2; attempt++) {
        let raw: string;
        try {
          const reply = await call(jsonSchema, convo, opts.temperature ?? cfg.temperature, opts.maxTokens, opts.timeoutMs, opts.signal);
          raw = reply.content;
          usage = addUsage(usage, reply.usage);
        } catch (err) {
          throw failed(err);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          lastError = "The reply was not valid JSON (it may have been cut off: keep it shorter).";
          convo.push({ role: "assistant", content: raw.slice(0, 2000) }, { role: "user", content: `${lastError} Reply again with only JSON that matches the schema.` });
          continue;
        }
        const result = schema.safeParse(cfg.reasoningEffort !== undefined ? dropNulls(parsed) : parsed);
        if (result.success) return { data: result.data, ms: Math.round(performance.now() - start), attempts: attempt, usage };
        lastError = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        convo.push({ role: "assistant", content: raw.slice(0, 2000) }, { role: "user", content: `That JSON didn't match the schema (${lastError}). Reply again with corrected JSON only.` });
      }
      throw failed(new LlmError(`Language model gave invalid output twice: ${lastError}`));
    },
  };
}
