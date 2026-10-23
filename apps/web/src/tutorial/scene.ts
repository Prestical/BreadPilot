import { resolveBuild } from "@breadpilot/circuit-core";
import { keyPos, resolvedWires, type SceneModel } from "../scene/model";
import { targetKey } from "../scene/targets";
import type { Vec3 } from "../scene/coords";
import type { TutorialState } from "../store";
import { CHAPTERS } from "./chapters";
import { chapterBuild } from "./engine";

export function tutorialScene(t: TutorialState, userLabels: boolean): { model: SceneModel; resolved: ReturnType<typeof resolveBuild>["resolved"] } {
  const chapter = CHAPTERS[t.chapter]!;
  const step = chapter.steps[t.step]!;
  const base = chapterBuild(chapter);
  const firstWireStep = chapter.steps.findIndex((s) => s.showWires);
  const showChapterWires = firstWireStep !== -1 && t.step >= firstWireStep;

  const build = t.attempt ? { ...base, wires: [...base.wires, t.attempt.wire] } : base;
  const { resolved } = resolveBuild(build);
  const attemptIndex = t.attempt ? build.wires.length - 1 : -1;

  const wires = resolved
    ? resolvedWires(resolved, build.wires, (i) => {
        if (i === attemptIndex) return t.attempt!.blocked ? "blocked" : "ok";
        if (!showChapterWires) return null;
        return t.step === firstWireStep ? "current" : "done";
      }).map((w) => (w.id === `w${attemptIndex}` ? { ...w, color: "white" } : { ...w, color: "black" }))
    : [];

  const highlights = [...(step.highlight ?? [])];
  if (t.pending) highlights.push(targetKey(t.pending));

  const focus = (step.focus ?? []).map(keyPos).filter((p): p is Vec3 => !!p);

  return {
    model: {
      pico: "done",
      parts: (resolved?.parts ?? []).map((part) => ({ part, state: "done" as const })),
      wires,
      highlights,
      focus: focus.length ? focus : null,
      showLabels: userLabels || !!step.labels,
    },
    resolved,
  };
}
