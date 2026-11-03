import type { PowerMode } from "@breadpilot/circuit-core";
import type { AiChoice, ApiProject, KeyCheck, LlmOptions, ProgressEvent, ProjectSummary, PullState, SettingsPatch, SettingsView } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the BreadPilot API. Is it running?", 0);
  }
  const data = (await res.json().catch(() => null)) as ({ message?: string } & T) | null;
  if (!res.ok) throw new ApiError(data?.message ?? `The API answered HTTP ${res.status}.`, res.status);
  return data as T;
}

// Long-running actions use ?async=1: the API answers at once and the stream reports progress.
export const startProject = (idea: string, power: PowerMode, llm: AiChoice) => call<ApiProject>("POST", "/api/projects?async=1", { idea, power, llm });
export const getLlmOptions = () => call<LlmOptions>("GET", "/api/llm-options");
/** Re-lays the GND/3V3 wires (no LLM), so it answers right away. */
export const setProjectPower = (id: string, power: PowerMode) => call<ApiProject>("POST", `/api/projects/${id}/power`, { power });
export const approveProject = (id: string, feedback?: string) => call<ApiProject>("POST", `/api/projects/${id}/approve?async=1`, feedback ? { feedback } : {});
/** Stops a running project (202); the events stream then reports it as failed and retryable. */
export const stopProject = (id: string) => call<{ stopping: boolean }>("POST", `/api/projects/${id}/stop`);
export const retryProject = (id: string) => call<ApiProject>("POST", `/api/projects/${id}/retry?async=1`);
export const getProject = (id: string) => call<ApiProject>("GET", `/api/projects/${id}`);
export const listProjects = () => call<ProjectSummary[]>("GET", "/api/projects");
/** Removes a project for good (204, no body). */
export const deleteProject = (id: string) => call<null>("DELETE", `/api/projects/${id}`);
export const handoffUrl = (id: string) => `/api/projects/${id}/handoff?download=1`;

// Settings (the OpenAI key goes in once and never comes back: answers only say whether it's set).
export const getSettings = () => call<SettingsView>("GET", "/api/settings");
export const saveSettings = (patch: SettingsPatch) => call<SettingsView>("PUT", "/api/settings", patch);
/** Checked with OpenAI first; saved only if it works. */
export const saveOpenAiKey = (key: string) => call<SettingsView & { check: KeyCheck }>("PUT", "/api/settings/openai-key", { key });
export const removeOpenAiKey = () => call<SettingsView>("DELETE", "/api/settings/openai-key");
/** Tests the pasted key, or the saved one when none is given. Saves nothing. */
/** Downloads one of the two models in Settings through Ollama; poll getPulls for progress. */
export const startPull = (model: string) => call<PullState>("POST", "/api/ollama/pull", { model });
export const getPulls = async () => (await call<{ pulls: PullState[] }>("GET", "/api/ollama/pulls")).pulls;
export const testOpenAiKey = (key?: string) => call<KeyCheck>("POST", "/api/settings/openai-key/test", key ? { key } : {});

export interface WatchHandlers {
  snapshot(p: ApiProject): void;
  progress(e: ProgressEvent): void;
  done(p: ApiProject): void;
  error(message: string): void;
}

/** Follows a project's events stream until it's done. Returns a function that stops watching. */
export function watchProject(id: string, h: WatchHandlers): () => void {
  const es = new EventSource(`/api/projects/${id}/events`);
  let finished = false;
  const end = () => {
    finished = true;
    es.close();
  };
  const parse = <T,>(e: Event) => JSON.parse((e as MessageEvent<string>).data) as T;
  es.addEventListener("snapshot", (e) => h.snapshot(parse(e)));
  es.addEventListener("progress", (e) => h.progress(parse(e)));
  es.addEventListener("done", (e) => {
    end();
    h.done(parse(e));
  });
  es.addEventListener("failed", (e) => {
    end();
    h.error(parse<{ message: string }>(e).message);
  });
  es.onerror = () => {
    // EventSource reconnects by itself; after a reconnect the snapshot brings the state back.
    // Give up only when the browser has closed the stream for good.
    if (!finished && es.readyState === EventSource.CLOSED) {
      finished = true;
      h.error("Lost the connection to the API.");
    }
  };
  return end;
}
