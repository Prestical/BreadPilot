// One part on its own, in 3D, for the "Supported parts" list (M11): the same shapes as the workbench,
// laid out by the real layout engine, on a small piece of board. Drag to turn it. Renders only when
// something changes (frameloop "demand"), so a few previews side by side cost little.
// A `model` (scene/upcoming.ts) shows a part whose pack isn't written yet, in the holes it names.
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { layoutProject, packByKind, resolveBuild, type ViewSpec } from "@breadpilot/circuit-core";
import { BOARD, holePos } from "./coords";
import { PartView } from "./Parts";
import { StudioLights } from "./Studio";
import { upcomingPart, type UpcomingModel } from "./upcoming";
import { useDark } from "../ui/theme";

/** A part with a piece lying on the mat beside the breadboard (the soil probe, the keypad). */
const liesBeside = (view: ViewSpec | undefined) => view?.shape === "keypad" || view?.shape === "tethered" || (view?.shape === "upright-module" && !!view.features?.some((f) => f.type === "probe"));

/** How far the camera stands back and the height it looks at (and how far sideways), from the part's own size (mm). */
export function previewFrame(view: ViewSpec | undefined): { size: number; lookY: number; lookX?: number } {
  switch (view?.shape) {
    case "header-module":
      return { size: Math.max(40, Math.max(...view.board.size) * 2), lookY: 4 };
    case "upright-module": {
      const tall = view.board.size[1];
      const probe = view.features?.some((f) => f.type === "probe");
      return { size: Math.max(46, Math.max(...view.board.size) * 1.875) * (probe ? 1.5 : 1), lookY: probe ? tall / 4 : tall / 2 };
    }
    case "grid-sensor":
      return { size: Math.round(view.body.size[1] * 2.95), lookY: Math.round(view.body.size[1] / 2) };
    case "keypad":
      return { size: Math.max(...view.size) * 2.3, lookY: -4, lookX: view.size[0] * 0.55 };
    case "seven-segment":
      return { size: 42, lookY: 5 };
    case "to92":
      return { size: 30, lookY: 6 };
    case "tethered": {
      // across, and how tall, the thing on the wires is
      const sizes: Record<typeof view.unit.type, [number, number]> = { servo: [33, 31], "dc-motor": [20, 20], "coin-motor": [10, 3], lcd: [80, 9], stepper: [68, 28] };
      const [wide, tall] = sizes[view.unit.type];
      return { size: 70 + wide * 1.7, lookY: tall / 2 - 4, lookX: 16 + wide / 2 };
    }
    case "to220":
      return { size: 44, lookY: 11 };
    case "can-capacitor":
      return { size: 34, lookY: view.height / 2 + 1 };
    case "rgb-led":
      return { size: 34, lookY: 7 };
    case "metal-can":
      return { size: 34, lookY: view.height / 2 + 1 };
    default:
      return { size: 34, lookY: 4 };
  }
}

export default function PartPreview({ kind, model, label }: { kind?: string; model?: UpcomingModel; label: string }) {
  const parts = useMemo(() => (model ? [upcomingPart(model)] : resolveBuild(layoutProject([{ kind: kind! }]).build).resolved?.parts ?? []), [kind, model]);
  const center = useMemo(() => {
    const pts = parts.flatMap((p) => Object.values(p.legs).map((h) => holePos(h)));
    const n = pts.length || 1;
    return pts.reduce<[number, number, number]>((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n], [0, 0, 0]);
  }, [parts]);
  const view = model?.view ?? (kind ? packByKind(kind)?.view : undefined);
  const { size, lookY, lookX = 0 } = previewFrame(view);
  const dark = useDark();
  // Parts whose front faces the centre channel (the buzzer module, the DHT11) are first shown from that side.
  const side = view?.shape === "upright-module" || view?.shape === "grid-sensor" ? -1 : 1;
  // A part with a piece beside the breadboard (the soil probe) gets the board's real edge and the mat under it.
  const beside = liesBeside(view);
  const slab = beside ? { from: center[0] - size * 0.3, to: BOARD.maxX } : { from: center[0] - size * 0.55, to: center[0] + size * 0.55 };
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 35, position: [center[0] + lookX + side * size * 0.55, size * 0.8, center[2] + size * 0.9] }} aria-label={`3D view of ${label}`} role="img">
      <StudioLights dark={dark} />
      {/* a small piece of breadboard under the part */}
      <mesh position={[(slab.from + slab.to) / 2, beside ? -BOARD.height / 2 : -1, center[2]]} raycast={() => null}>
        <boxGeometry args={[slab.to - slab.from, beside ? BOARD.height : 2, size * 0.9]} />
        <meshStandardMaterial color="#f3f1ea" roughness={0.85} />
      </mesh>
      {beside && (
        <mesh position={[center[0] + size * 0.2, -BOARD.height - 1, center[2] - (view?.shape === "keypad" ? size * 0.15 : 0)]} raycast={() => null}>
          <boxGeometry args={[size * 1.1, 2, size * 1.05]} />
          <meshStandardMaterial color="#2c6e55" roughness={0.9} />
        </mesh>
      )}
      <ContactShadows frames={1} position={[center[0], 0.02, center[2]]} scale={size * 1.1} resolution={512} blur={1.6} far={20} opacity={0.45} />
      {parts.map((p) => (
        <PartView key={p.ref} part={p} state="done" view={model?.view} onHover={() => {}} />
      ))}
      <OrbitControls target={[center[0] + lookX, lookY, center[2]]} enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
