// The user's own edits to a project's main.py (pure helpers, unit-tested). Edits stay in this
// browser (localStorage, one entry per project) and are re-checked with the same checker the
// agent's code had to pass, so the user sees at once whether the code still matches the wiring.
import { checkMicroPython, getBoard, type Build, type CodeCheckReport } from "@breadpilot/circuit-core";

const key = (projectId: string) => `breadpilot.code.${projectId}`;

/** The saved edit for a project, or null when the user hasn't changed the generated code. */
export function loadEdit(projectId: string, generated: string): string | null {
  try {
    const saved = localStorage.getItem(key(projectId));
    return saved !== null && saved !== generated ? saved : null;
  } catch {
    return null; // storage blocked: edits just aren't remembered
  }
}

/** Saves the user's code; saving the generated code (or null) removes the edit. */
export function saveEdit(projectId: string, generated: string, code: string | null): void {
  try {
    if (code === null || code === generated) localStorage.removeItem(key(projectId));
    else localStorage.setItem(key(projectId), code);
  } catch {
    /* not remembered across reloads */
  }
}

/** Checks edited code against the project's validated wiring (the agent's checker, run in the browser). */
export function checkDraft(code: string, build: Build): CodeCheckReport {
  const board = getBoard(build.boardId);
  if (!board) return { ok: false, issues: [{ code: "C000", severity: "error", message: `Unknown board "${build.boardId}".` }], used: {} };
  return checkMicroPython(code, build, board);
}

/** Inserts 4 spaces at the cursor (Tab in the editor); returns the new text and cursor position. */
export function insertIndent(text: string, start: number, end: number): { text: string; cursor: number } {
  return { text: `${text.slice(0, start)}    ${text.slice(end)}`, cursor: start + 4 };
}
