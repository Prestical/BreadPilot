import { create } from "zustand";
import type { PowerMode, Wire } from "@breadpilot/circuit-core";
import type { HoverInfo } from "./scene/Workbench";
import type { Target } from "./scene/targets";
import { CHAPTERS } from "./tutorial/chapters";
import { checkClick, checkWire, type Feedback } from "./tutorial/engine";
import { loadProject } from "./demos";
import * as api from "./projects/api";
import type { AiChoice, ApiProject, LlmOptions, ProgressEvent, ProjectSummary } from "./projects/types";
import { projectView, type BuildView } from "./projects/view";

export type Mode = "tutorial" | "build";
/** What the Build tab shows: a built-in example or a project made by the agent. */
export type Source = { kind: "demo"; id: string } | { kind: "agent"; id: string };

export interface AgentState {
  project: ApiProject | null;
  /** Live events of the current run (cleared when a new run starts). */
  events: ProgressEvent[];
  /** A request is in flight or the pipeline is running. */
  busy: boolean;
  /** When the current run started (for the elapsed-time counter). */
  startedAt: number | null;
  error: string | null;
  list: ProjectSummary[];
}

export interface TutorialState {
  chapter: number;
  step: number;
  feedback: Feedback | null;
  passed: boolean;
  pending: Target | null;
  attempt: { wire: Wire; dsl: string; ok: boolean; blocked: boolean } | null;
  completed: string[];
  finished: boolean;
}

interface AppState {
  mode: Mode;
  showLabels: boolean;
  resetSignal: number;
  hover: HoverInfo | null;
  source: Source;
  stepIndex: number;
  /** The right-hand Code panel (shown when the open project has code). */
  codeOpen: boolean;
  /** Narrow screens: the project sidebar is a drawer. */
  sidebarOpen: boolean;
  /** Text in the prompt bar (example chips fill it in). */
  draft: string;
  /** Power wiring for examples and new projects (an agent project keeps its own `power`). */
  power: PowerMode;
  /** The model for new projects, picked by the user on the start screen (default: local). */
  ai: AiChoice;
  /** What the API offers (null until loaded, or when the API can't be reached). */
  aiOptions: LlmOptions | null;
  agent: AgentState;
  tut: TutorialState;

  setMode(mode: Mode): void;
  toggleLabels(): void;
  resetCamera(): void;
  setHover(h: HoverInfo | null): void;
  openDemo(id: string): void;
  setStep(i: number): void;
  setCodeOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  setDraft(text: string): void;
  /** Leaves the open project with an error banner hidden. */
  dismissError(): void;
  setPower(power: PowerMode): Promise<void>;
  setAi(ai: AiChoice): void;
  loadAiOptions(): Promise<void>;
  startIdea(idea: string): Promise<void>;
  openProject(id: string): Promise<void>;
  approve(feedback?: string): Promise<void>;
  retry(): Promise<void>;
  /** Stops the running project at its current model call. */
  stop(): Promise<void>;
  refreshList(): Promise<void>;
  /** Deletes a project for good; if it's the open one, the new-idea screen is shown. */
  removeProject(id: string): Promise<void>;
  newProject(): void;
  tutGo(chapter: number): void;
  tutNext(): void;
  tutBack(): void;
  tutTarget(t: Target): void;
}

const STORAGE_KEY = "breadpilot.tutorial.completed";
const PROJECT_KEY = "breadpilot.project";
const POWER_KEY = "breadpilot.power";
const AI_KEY = "breadpilot.ai";

function loadAi(): AiChoice {
  try {
    return localStorage.getItem(AI_KEY) === "openai" ? "openai" : "local";
  } catch {
    return "local";
  }
}

function loadPower(): PowerMode {
  try {
    return localStorage.getItem(POWER_KEY) === "direct" ? "direct" : "rails";
  } catch {
    return "rails";
  }
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    /* not remembered across reloads */
  }
}

export function rememberedProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

/** The power wiring shown now: the open agent project's own choice, otherwise the preference. */
export function currentPower(s: Pick<AppState, "source" | "agent" | "power">): PowerMode {
  const p = s.agent.project;
  return s.source.kind === "agent" && p && p.id === s.source.id ? (p.power ?? "rails") : s.power;
}

/** The build the 3D view and step player show right now (null: nothing to build yet). */
export function activeBuild(s: Pick<AppState, "source" | "agent" | "power">): BuildView | null {
  if (s.source.kind === "demo") return loadProject(s.source.id, s.power);
  const p = s.agent.project;
  if (!p || p.id !== s.source.id) return null;
  const v = projectView(p);
  return v.kind === "build" ? v.view : null;
}

let stopWatching: (() => void) | null = null;

function loadCompleted(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveCompleted(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* private mode: progress just isn't remembered */
  }
}

const freshStep = { feedback: null, passed: false, pending: null, attempt: null } as const;

export const useApp = create<AppState>((set, get) => {
  const patchAgent = (patch: Partial<AgentState>) => set((s) => ({ agent: { ...s.agent, ...patch } }));

  /** Shows a project; when it's running, follows its events stream until it's done. */
  const show = (p: ApiProject, fresh: boolean) => {
    stopWatching?.();
    stopWatching = null;
    const prev = get().agent.project;
    const keepStep = !fresh && prev?.id === p.id && prev.updatedAt === p.updatedAt;
    set((s) => ({
      source: { kind: "agent", id: p.id },
      stepIndex: keepStep ? s.stepIndex : 0,
      agent: { ...s.agent, project: p, busy: p.running, error: null, ...(fresh ? { events: [], startedAt: p.running ? Date.now() : null } : {}) },
    }));
    remember(p.id);
    if (!p.running) return;
    stopWatching = api.watchProject(p.id, {
      snapshot: (snap) => {
        if (get().agent.project?.id !== p.id) return;
        const events = get().agent.events;
        patchAgent({ project: snap, ...(snap.current && !events.length ? { events: [snap.current] } : {}) });
      },
      progress: (e) => {
        if (get().agent.project?.id !== p.id) return;
        const project = get().agent.project;
        patchAgent({ events: [...get().agent.events, e], ...(e.usage && project ? { project: { ...project, usage: e.usage } } : {}) });
      },
      done: (final) => {
        stopWatching = null;
        if (get().agent.project?.id !== p.id) return;
        // The Code panel stays closed: open, it covers the step pop-ups. The last step leads to it.
        set((s) => ({ stepIndex: 0, agent: { ...s.agent, project: final, busy: false, startedAt: null } }));
        void get().refreshList();
      },
      error: (message) => {
        stopWatching = null;
        patchAgent({ busy: false, startedAt: null, error: message });
        // The run may still have finished: reload what's stored.
        void api.getProject(p.id).then((latest) => get().agent.project?.id === p.id && patchAgent({ project: latest, busy: latest.running }), () => {});
      },
    });
  };

  const act = async (request: () => Promise<ApiProject>) => {
    patchAgent({ busy: true, error: null, events: [], startedAt: Date.now() });
    try {
      show(await request(), true);
      void get().refreshList();
    } catch (err) {
      patchAgent({ busy: false, startedAt: null, error: (err as Error).message });
    }
  };

  return {
  mode: loadCompleted().length >= CHAPTERS.length ? "build" : "tutorial",
  // Pin labels on from the start: beginners need the pin names to follow the steps.
  showLabels: true,
  resetSignal: 0,
  hover: null,
  // Start on the new-idea form; the examples are one click away in the project pane.
  source: { kind: "agent", id: "" },
  stepIndex: 0,
  codeOpen: false,
  sidebarOpen: false,
  draft: "",
  power: loadPower(),
  ai: loadAi(),
  aiOptions: null,
  agent: { project: null, events: [], busy: false, startedAt: null, error: null, list: [] },
  tut: { chapter: 0, step: 0, ...freshStep, completed: loadCompleted(), finished: false },

  setMode: (mode) => set({ mode, hover: null }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  resetCamera: () => set((s) => ({ resetSignal: s.resetSignal + 1 })),
  setHover: (hover) => set({ hover }),
  openDemo: (id) => {
    stopWatching?.();
    stopWatching = null;
    remember(null);
    set((s) => ({ mode: "build", sidebarOpen: false, source: { kind: "demo", id }, stepIndex: 0, agent: { ...s.agent, project: null, busy: false, events: [], startedAt: null, error: null } }));
  },
  setStep: (i) => {
    const max = (activeBuild(get())?.steps.length ?? 1) - 1;
    const stepIndex = Math.max(0, Math.min(max, i));
    // Moving through the wiring closes the Code panel: open, it leaves the step pop-up no room and
    // it lands on the circuit. "</> Code" or the last step's "Put it on your Pico" open it again.
    set((s) => ({ stepIndex, codeOpen: stepIndex === s.stepIndex ? s.codeOpen : false }));
  },
  setCodeOpen: (codeOpen) => set({ codeOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setDraft: (draft) => set({ draft }),
  dismissError: () => patchAgent({ error: null }),
  startIdea: (idea) => {
    set({ mode: "build" });
    return act(() => api.startProject(idea, get().power, get().ai));
  },
  setAi: (ai) => {
    try {
      localStorage.setItem(AI_KEY, ai);
    } catch {
      /* not remembered across reloads */
    }
    set({ ai });
  },
  loadAiOptions: async () => {
    try {
      const aiOptions = await api.getLlmOptions();
      // A remembered OpenAI choice falls back to the local model when the key is gone.
      set((s) => ({ aiOptions, ai: s.ai === "openai" && !aiOptions.openai.available ? "local" : s.ai }));
    } catch {
      set({ aiOptions: null });
    }
  },
  setPower: async (power) => {
    // The choice is also the default for examples and the next new project.
    try {
      localStorage.setItem(POWER_KEY, power);
    } catch {
      /* not remembered across reloads */
    }
    set({ power });
    const s = get();
    const p = s.source.kind === "agent" ? s.agent.project : null;
    if (!p || p.id !== s.source.id || (p.power ?? "rails") === power) {
      get().setStep(get().stepIndex); // clamp: the example's step count may differ
      return;
    }
    patchAgent({ busy: true, error: null });
    try {
      const updated = await api.setProjectPower(p.id, power);
      if (get().agent.project?.id !== p.id) return;
      patchAgent({ project: updated, busy: false });
      get().setStep(get().stepIndex);
    } catch (err) {
      patchAgent({ busy: false, error: (err as Error).message });
    }
  },
  approve: async (feedback) => {
    const id = get().agent.project?.id;
    if (id) await act(() => api.approveProject(id, feedback));
  },
  stop: async () => {
    const id = get().agent.project?.id;
    if (!id) return;
    try {
      await api.stopProject(id);
    } catch (err) {
      patchAgent({ error: (err as Error).message });
    }
  },
  retry: async () => {
    const id = get().agent.project?.id;
    if (id) await act(() => api.retryProject(id));
  },
  openProject: async (id) => {
    patchAgent({ error: null });
    try {
      show(await api.getProject(id), true);
    } catch (err) {
      if ((err as api.ApiError).status === 404) remember(null);
      patchAgent({ error: (err as Error).message });
    }
  },
  removeProject: async (id) => {
    try {
      await api.deleteProject(id);
    } catch (err) {
      // Already gone (404) is fine: just refresh the list.
      if ((err as api.ApiError).status !== 404) {
        patchAgent({ error: (err as Error).message });
        return;
      }
    }
    const s = get();
    if (s.source.kind === "agent" && s.source.id === id) s.newProject();
    else if (rememberedProject() === id) remember(null);
    patchAgent({ list: get().agent.list.filter((x) => x.id !== id) });
    void get().refreshList();
  },
  refreshList: async () => {
    try {
      patchAgent({ list: await api.listProjects() });
    } catch {
      /* the list is a convenience; the API badge shows when it's down */
    }
  },
  newProject: () => {
    stopWatching?.();
    stopWatching = null;
    remember(null);
    set((s) => ({ mode: "build", sidebarOpen: false, source: { kind: "agent", id: "" }, stepIndex: 0, agent: { ...s.agent, project: null, busy: false, events: [], startedAt: null, error: null } }));
  },

  tutGo: (chapter) => set((s) => ({ tut: { ...s.tut, chapter, step: 0, ...freshStep, finished: false } })),
  tutBack: () =>
    set((s) => {
      const { chapter, step } = s.tut;
      if (step > 0) return { tut: { ...s.tut, step: step - 1, ...freshStep } };
      if (chapter > 0) return { tut: { ...s.tut, chapter: chapter - 1, step: CHAPTERS[chapter - 1]!.steps.length - 1, ...freshStep } };
      return {};
    }),
  tutNext: () =>
    set((s) => {
      const t = s.tut;
      const ch = CHAPTERS[t.chapter]!;
      const expect = ch.steps[t.step]!.expect;
      if (expect.type !== "next" && !t.passed) return {};
      if (t.step + 1 < ch.steps.length) return { tut: { ...t, step: t.step + 1, ...freshStep } };
      const completed = t.completed.includes(ch.id) ? t.completed : [...t.completed, ch.id];
      saveCompleted(completed);
      if (t.chapter + 1 < CHAPTERS.length) return { tut: { ...t, chapter: t.chapter + 1, step: 0, ...freshStep, completed } };
      return { tut: { ...t, ...freshStep, completed, finished: true } };
    }),
  tutTarget: (target) =>
    set((s) => {
      const t = s.tut;
      const ch = CHAPTERS[t.chapter]!;
      const expect = ch.steps[t.step]!.expect;
      if (t.passed || expect.type === "next") return {};
      if (expect.type === "click") {
        const feedback = checkClick(expect, target);
        return { tut: { ...t, feedback, passed: feedback.ok } };
      }
      if (!t.pending) return { tut: { ...t, pending: target, attempt: null, feedback: { ok: false, message: "Good. Now click where the other end of the wire goes." } } };
      const r = checkWire(ch, expect, t.pending, target);
      const blocked = !!expect.mustFail || !r.ok;
      return { tut: { ...t, pending: null, feedback: r, passed: r.ok, attempt: { wire: r.wire, dsl: r.dsl, ok: r.ok, blocked } } };
    }),
  };
});
