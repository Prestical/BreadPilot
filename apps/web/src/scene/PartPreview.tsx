// One part on its own, in 3D, for the "Supported parts" list (M11): the same shapes as the workbench,
// laid out by the real layout engine, on a small piece of board. Drag to turn it. Renders only when
// something changes (frameloop "demand"), so a few previews side by side cost little.
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { layoutProject, resolveBuild } from "@breadpilot/circuit-core";
import { holePos } from "./coords";
import { PartView } from "./Parts";

export default function PartPreview({ kind, label }: { kind: string; label: string }) {
  const parts = useMemo(() => resolveBuild(layoutProject([{ kind }]).build).resolved?.parts ?? [], [kind]);
  const center = useMemo(() => {
    const pts = parts.flatMap((p) => Object.values(p.legs).map((h) => holePos(h)));
    const n = pts.length || 1;
    return pts.reduce<[number, number, number]>((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n], [0, 0, 0]);
  }, [parts]);
  const size = kind === "oled" ? 70 : 34;
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 35, position: [center[0] + size * 0.55, size * 0.8, center[2] + size * 0.9] }} aria-label={`3D view of ${label}`} role="img">
      <hemisphereLight args={["#ffffff", "#8a8f99", 1.6]} />
      <directionalLight position={[40, 120, 60]} intensity={2.2} />
      {/* a small piece of breadboard under the part */}
      <mesh position={[center[0], -1, center[2]]} raycast={() => null}>
        <boxGeometry args={[size * 1.1, 2, size * 0.9]} />
        <meshStandardMaterial color="#f3f1ea" roughness={0.85} />
      </mesh>
      <ContactShadows frames={1} position={[center[0], 0.02, center[2]]} scale={size * 1.1} resolution={512} blur={1.6} far={20} opacity={0.45} />
      {parts.map((p) => (
        <PartView key={p.ref} part={p} state="done" onHover={() => {}} />
      ))}
      <OrbitControls target={[center[0], 4, center[2]]} enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
