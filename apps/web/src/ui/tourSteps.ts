// The guided tour (pure, unit-tested): its steps, and where each popup goes next to the highlighted
// part of the app. Targets are elements with data-tour="<target>"; a step whose target isn't on
// screen (e.g. the sidebar on a narrow window) is left out.

export interface TourStep {
  target: string;
  title: string;
  text: string;
}

/** Short on purpose: one idea per stop. */
export const TOUR: TourStep[] = [
  { target: "stage", title: "Your workbench", text: "Your circuit is built here on a 3D breadboard. Drag to turn it, scroll to zoom, hover a hole to see what it's connected to." },
  { target: "prompt", title: "Describe your idea", text: "Type a project in plain words, like “an LED that blinks when I press a button”, and press Enter. BreadPilot plans it, checks the wiring and writes the code." },
  { target: "model", title: "Pick the AI", text: "Local AI is free and private; OpenAI is stronger at code. The dot shows if it's ready: green is ready, yellow needs a look." },
  { target: "power", title: "Power wiring", text: "Power the parts through the breadboard's side rails, or with wires straight from the board." },
  { target: "view", title: "Pin labels", text: "Show or hide the pin names. “Reset view” next to it brings the camera back." },
  { target: "examples", title: "Examples", text: "Finished builds to explore step by step. No AI needed." },
  { target: "tutorial", title: "New to breadboards?", text: "A short hands-on lesson on how a breadboard and the board's pins work." },
  { target: "new", title: "Your projects", text: "Start a new idea here. Every project is saved and listed below." },
  { target: "settings", title: "Settings", text: "Your OpenAI key, the local AI and browser access. You can replay this tour from here." },
];

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = "bottom" | "top" | "right" | "left" | "center";

/** Space between the highlight and the popup, and to the window edge. */
const GAP = 14;
const EDGE = 12;

/**
 * Where the popup goes: below the target if it fits, else above, right, left; over a target that
 * fills most of the window (the 3D stage), in its middle. Always kept inside the window.
 */
export function placePopup(target: Rect, popup: { width: number; height: number }, view: { width: number; height: number }): { top: number; left: number; side: Side } {
  const clampLeft = (x: number) => Math.max(EDGE, Math.min(x, view.width - popup.width - EDGE));
  const clampTop = (y: number) => Math.max(EDGE, Math.min(y, view.height - popup.height - EDGE));
  const centerX = target.left + target.width / 2 - popup.width / 2;
  const centerY = target.top + target.height / 2 - popup.height / 2;

  const big = target.width * target.height > 0.45 * view.width * view.height;
  if (!big) {
    const below = target.top + target.height + GAP;
    if (below + popup.height <= view.height - EDGE) return { top: below, left: clampLeft(centerX), side: "bottom" };
    const above = target.top - GAP - popup.height;
    if (above >= EDGE) return { top: above, left: clampLeft(centerX), side: "top" };
    const right = target.left + target.width + GAP;
    if (right + popup.width <= view.width - EDGE) return { top: clampTop(centerY), left: right, side: "right" };
    const left = target.left - GAP - popup.width;
    if (left >= EDGE) return { top: clampTop(centerY), left, side: "left" };
  }
  return { top: clampTop(centerY), left: clampLeft(centerX), side: "center" };
}

/** A target counts when it's in the page and takes up space (hidden elements measure 0×0). */
export const visible = (r: Rect | null): r is Rect => !!r && r.width > 0 && r.height > 0;
