import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DEMOS } from "./demos";
import { partsNeeded } from "./projects/parts";
import { PowerToggle } from "./projects/PowerToggle";
import { emptyResolved } from "./projects/view";
import { buildScene } from "./scene/model";
import { activeBuild, rememberedProject, useApp } from "./store";
import { TutorialPanel } from "./tutorial/TutorialPanel";
import { tutorialScene } from "./tutorial/scene";
import { CodeSide } from "./ui/CodeSide";
import { PromptBar } from "./ui/PromptBar";
import { Sidebar } from "./ui/Sidebar";
import { StageOverlay } from "./ui/StageOverlay";
import { StepCard, StepStrip } from "./ui/StepCard";

// three.js is big: load the 3D view separately so the page shell paints first.
const Workbench = lazy(() => import("./scene/Workbench"));

/** Below this width the step pop-up docks above the prompt instead of floating in 3D. */
const NARROW = "(max-width: 900px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function App() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const showLabels = useApp((s) => s.showLabels);
  const toggleLabels = useApp((s) => s.toggleLabels);
  const resetCamera = useApp((s) => s.resetCamera);
  const resetSignal = useApp((s) => s.resetSignal);
  const hover = useApp((s) => s.hover);
  const setHover = useApp((s) => s.setHover);
  const source = useApp((s) => s.source);
  const agent = useApp((s) => s.agent);
  const power = useApp((s) => s.power);
  const stepIndex = useApp((s) => s.stepIndex);
  const setStep = useApp((s) => s.setStep);
  const tut = useApp((s) => s.tut);
  const tutTarget = useApp((s) => s.tutTarget);
  const codeOpen = useApp((s) => s.codeOpen);
  const setCodeOpen = useApp((s) => s.setCodeOpen);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const setSidebarOpen = useApp((s) => s.setSidebarOpen);
  const narrow = useNarrow();
  const popupRef = useRef<HTMLDivElement>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const view = mode === "build" ? activeBuild({ source, agent, power }) : null;
  const project = source.kind === "agent" && agent.project?.id === source.id ? agent.project : null;
  const hasCode = mode === "build" && !!project?.build?.code && !agent.busy;
  const showCode = hasCode && codeOpen;

  const { model, resolved } = useMemo(() => {
    if (mode === "tutorial") return tutorialScene(tut, showLabels);
    if (!view) return { model: buildScene(emptyResolved(), [], [], 0, showLabels), resolved: emptyResolved() };
    return { model: buildScene(view.resolved, view.build.wires, view.steps, stepIndex, showLabels), resolved: view.resolved };
  }, [mode, tut, showLabels, view, stepIndex]);

  // Reopen the last project after a reload, and load the project list and the model options.
  useEffect(() => {
    const { openProject, refreshList, loadAiOptions } = useApp.getState();
    void refreshList();
    void loadAiOptions();
    const last = rememberedProject();
    if (last) void openProject(last);
  }, []);

  // ← / → step through the build.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (mode !== "build" || codeOpen || t instanceof HTMLSelectElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") setStep(stepIndex + 1);
      if (e.key === "ArrowLeft") setStep(stepIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, codeOpen, stepIndex, setStep]);

  // While a run is in progress or a plan waits, the overlay card has the stage, not the step.
  const showSteps = !!view && !agent.busy && project?.state !== "AWAIT_APPROVAL";
  const need = useMemo(() => (view ? partsNeeded(view.build) : undefined), [view]);
  const stepCard = showSteps ? <StepCard steps={view.steps} docked={narrow} need={need} hasCode={hasCode} /> : null;
  // What's open, so the 3D view isn't anonymous: the project's title and goal, or the example's.
  const demo = source.kind === "demo" ? DEMOS.find((d) => d.id === source.id) : undefined;
  const head = mode !== "build" ? null : project ? { title: project.title, goal: project.plans.at(-1)?.goal } : demo ? { title: demo.title, goal: demo.description } : null;

  return (
    <div className={`shell${mode === "tutorial" ? " with-right" : ""}`}>
      <a className="skip-link" href="#stage">
        Skip to the build
      </a>
      <Sidebar />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className="stage" id="stage" tabIndex={-1} aria-label="3D workbench">
        {!sceneReady && (
          <div className="loading scene-loading" role="status">
            Loading the 3D workbench…
          </div>
        )}
        <Suspense fallback={null}>
          <Workbench
            model={model}
            resolved={resolved}
            resetSignal={resetSignal}
            onHover={setHover}
            onTarget={(t) => {
              if (mode === "tutorial") tutTarget(t);
            }}
            popupTarget={!narrow && stepCard ? popupRef : undefined}
            onReady={() => setSceneReady(true)}
          />
        </Suspense>

        {/* Moved every frame to the current step's spot beside the board (PinToScreen). */}
        {!narrow && stepCard && (
          <div ref={popupRef} className="step-anchor">
            {stepCard}
          </div>
        )}

        <div className="stage-top">
          <div className="view-tools">
            <button type="button" className="icon-btn menu-btn" aria-label="Show projects" onClick={() => setSidebarOpen(true)}>
              ☰
            </button>
            {mode === "build" && <PowerToggle />}
            <button type="button" onClick={toggleLabels} aria-pressed={showLabels}>
              {showLabels ? "Hide pin labels" : "Show pin labels"}
            </button>
            <button type="button" onClick={resetCamera}>
              Reset view
            </button>
          </div>
          {head && (
            <div className="project-head">
              <h1>{head.title}</h1>
              {head.goal && <p>{head.goal}</p>}
            </div>
          )}
          <div className="view-tools right">
            {mode === "tutorial" && (
              <button type="button" onClick={() => setMode("build")}>
                Back to building
              </button>
            )}
            {hasCode && !codeOpen && (
              <button type="button" className="code-btn" onClick={() => setCodeOpen(true)}>
                {"</>"} Code
              </button>
            )}
          </div>
        </div>

        {mode === "build" && (
          <div className="stage-bottom">
            <StageOverlay />
            {narrow && stepCard}
            {showSteps && <StepStrip steps={view.steps} />}
            <PromptBar />
            <p className="view-help muted small">Drag to rotate · scroll to zoom · right-drag to pan · hover a hole for its connections</p>
          </div>
        )}

        {/* Slides over the whole stage from the right; stays mounted so it can slide back out. */}
        {hasCode && project && <CodeSide p={project} open={showCode} />}

        {hover && (
          <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
            {hover.lines.map((l, i) => (
              <div key={i} className={i === 0 ? "tt-title" : ""}>
                {l}
              </div>
            ))}
          </div>
        )}
      </main>

      {mode === "tutorial" && (
        <aside className="code-side" aria-label="Tutorial">
          <TutorialPanel />
        </aside>
      )}
    </div>
  );
}
