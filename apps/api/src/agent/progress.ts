// Live progress for running projects (Milestone 5). The pipeline emits stage events here;
// the SSE route (`GET /api/projects/:id/events`) forwards them to the browser. In-process only:
// the API is a single process, and the stored project is the source of truth after a restart.

import type { Project, StageEvent } from "./project";

export type ProgressEvent =
  | { type: "stage"; stage: StageEvent["stage"]; status: "start" | StageEvent["status"]; attempt?: number; detail?: string; ms?: number; at: string; usage?: Project["usage"] }
  /** The run ended (any final state); `project` is what was saved. */
  | { type: "done"; project: Project }
  /** The run crashed outside the pipeline's own error handling (e.g. the database went away). */
  | { type: "error"; message: string };

export type ProgressListener = (event: ProgressEvent) => void;

export interface ProgressBus {
  emit(projectId: string, event: ProgressEvent): void;
  subscribe(projectId: string, listener: ProgressListener): () => void;
  /** The latest stage event of a running project (a late subscriber learns what's going on now). */
  latest(projectId: string): Extract<ProgressEvent, { type: "stage" }> | undefined;
}

export function progressBus(): ProgressBus {
  const listeners = new Map<string, Set<ProgressListener>>();
  const last = new Map<string, Extract<ProgressEvent, { type: "stage" }>>();
  return {
    latest: (id) => last.get(id),
    emit(id, event) {
      if (event.type === "stage") last.set(id, event);
      else last.delete(id);
      for (const fn of [...(listeners.get(id) ?? [])]) {
        try {
          fn(event);
        } catch {
          /* one broken listener (e.g. a closed socket) must not stop the pipeline */
        }
      }
    },
    subscribe(id, fn) {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
        if (!set.size) listeners.delete(id);
      };
    },
  };
}
