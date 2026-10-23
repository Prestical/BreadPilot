import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import type { Resolved } from "@breadpilot/circuit-core";
import { Breadboard } from "./Breadboard";
import { BOARD } from "./coords";
import { describePart, describeTarget } from "./describe";
import { Jumper } from "./Jumper";
import { clampPopup, popupAnchor, type SceneModel } from "./model";
import { PartView } from "./Parts";
import { Pico } from "./Pico";
import type { Target } from "./targets";

export interface HoverInfo {
  lines: string[];
  x: number;
  y: number;
}

export interface WorkbenchProps {
  model: SceneModel;
  resolved: Resolved | null;
  /** Increment to fly back to the overview. */
  resetSignal: number;
  onHover(info: HoverInfo | null): void;
  onTarget(target: Target): void;
  /**
   * The step pop-up (a normal DOM element in the stage). Every frame it is moved to the screen
   * position of the current step's anchor, just right of the board.
   */
  popupTarget?: RefObject<HTMLDivElement | null>;
  /** Called once the 3D view has drawn (the page shows "Loading…" until then). */
  onReady?: () => void;
}



const DARK = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

const OVERVIEW = { pos: [0, 175, 150] as const, target: [0, 0, 8] as const };
/**
 * Direction from a step's focus to the camera (unit length): right (+x), up (y), toward the user (+z).
 * From the right, the board turns away from the step pop-up (pinned past its right edge), so the
 * pop-up no longer covers the holes of the step.
 */
export const STEP_VIEW = [0.42, 0.68, 0.6] as const;

function CameraRig({ focus, resetSignal }: { focus: SceneModel["focus"]; resetSignal: number }) {
  const ref = useRef<CameraControls>(null);

  useEffect(() => {
    ref.current?.setLookAt(...OVERVIEW.pos, ...OVERVIEW.target, false);
  }, []);

  useEffect(() => {
    if (resetSignal > 0) ref.current?.setLookAt(...OVERVIEW.pos, ...OVERVIEW.target, true);
  }, [resetSignal]);

  // Keyed by value: re-renders with equal focus points must not move the camera.
  const focusKey = focus ? JSON.stringify(focus) : "";
  useEffect(() => {
    const controls = ref.current;
    if (!controls || !focus?.length) return;
    // Centered on the step's own points; the pop-up sits beside the board (clampPopup).
    const box = new Box3().setFromPoints(focus.map((p) => new Vector3(...p)));
    box.expandByVector(new Vector3(14, 6, 14));
    // A slight side view from the front-right (about 43° up, 35° to the side): a straight-down view
    // flattens the holes, so it was hard to see which hole a wire end or leg goes into.
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const dist = Math.max(70, size * 1.25);
    const [dx, dy, dz] = STEP_VIEW;
    void controls.setLookAt(center.x + dist * dx, center.y + dist * dy, center.z + dist * dz, center.x, center.y, center.z, true);
  }, [focusKey]);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={25}
      maxDistance={420}
      maxPolarAngle={Math.PI * 0.47}
      smoothTime={0.45}
    />
  );
}

/**
 * Pins a DOM element to a 3D point. Replaces drei's <Html>, whose separate React root stayed
 * empty (and left the first frame undrawn) when the canvas mounted with a step already open,
 * e.g. after a page reload.
 */
function PinToScreen({ anchor, target }: { anchor: [number, number, number]; target: RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const el = target.current;
    if (!el) return;
    v.set(...anchor).project(camera);
    const [x, y] = clampPopup((v.x + 1) * (size.width / 2), (1 - v.y) * (size.height / 2), size);
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    el.style.visibility = v.z > 1 ? "hidden" : "visible"; // behind the camera
  });
  return null;
}

export default function Workbench({ model, resolved, resetSignal, onHover, onTarget, popupTarget, onReady }: WorkbenchProps) {
  const anchor = popupTarget ? popupAnchor(model.focus) : null;
  const hoverTarget = (t: Target | null, e?: ThreeEvent<PointerEvent>) => {
    if (!t || !e) return onHover(null);
    onHover({ lines: describeTarget(t, resolved), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  const hoverPart = (ref: string | null, e?: ThreeEvent<PointerEvent>) => {
    if (!ref || !e) return onHover(null);
    onHover({ lines: describePart(ref, resolved), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  return (
    <Canvas
      camera={{ fov: 40, near: 1, far: 2000, position: [...OVERVIEW.pos] }}
      dpr={[1, 2]}
      onPointerMissed={() => onHover(null)}
      onCreated={() => requestAnimationFrame(() => onReady?.())}
      aria-label="3D view of the breadboard and Raspberry Pi Pico 2 W"
      role="img"
    >
      {/* No scene background: the CSS gradient behind the canvas shows through (.viewport). */}
      <hemisphereLight args={["#ffffff", "#8a8f99", DARK ? 1.7 : 1.4]} />
      <directionalLight position={[60, 160, 90]} intensity={2.2} />
      <directionalLight position={[-80, 90, -60]} intensity={0.6} />
      {/* Soft light pool over the board, which gives the glossy table a gentle sheen. */}
      <spotLight position={[0, 260, 120]} angle={0.55} penumbra={1} decay={0} intensity={DARK ? 1.6 : 0.8} />

      {/* Table */}
      <mesh position={[0, -BOARD.height - 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color={DARK ? "#353d4b" : "#dfe4ea"} roughness={0.38} metalness={0.15} />
      </mesh>

      <Breadboard highlights={model.highlights} onHover={hoverTarget} onClick={onTarget} />
      {model.pico !== "hidden" && (
        <Pico showLabels={model.showLabels} highlights={model.highlights} ghost={model.pico === "ghost"} onHover={hoverTarget} onClick={onTarget} />
      )}
      {model.parts.map((p) => (
        <PartView key={p.part.ref} part={p.part} state={p.state} lit={p.lit ?? false} onHover={hoverPart} />
      ))}
      {model.wires.map((w) => (
        <Jumper key={w.id} from={w.from} to={w.to} color={w.color} state={w.state} />
      ))}

      {anchor && popupTarget && <PinToScreen anchor={anchor} target={popupTarget} />}

      <CameraRig focus={model.focus} resetSignal={resetSignal} />
    </Canvas>
  );
}
