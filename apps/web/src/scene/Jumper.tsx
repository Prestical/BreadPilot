import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CatmullRomCurve3, TubeGeometry, Vector3, type MeshStandardMaterial } from "three";
import type { Vec3 } from "./coords";

export type JumperState = "done" | "current" | "ghost" | "blocked" | "ok";

const COLOR_HEX: Record<string, string> = {
  black: "#1f2125", red: "#e0312f", yellow: "#f5c518", green: "#22a94f", blue: "#2563eb",
  orange: "#f2801c", white: "#eef0f3", purple: "#8b45d6",
};

export function wireHex(color: string): string {
  return COLOR_HEX[color] ?? color;
}

/** A jumper wire arcing between two holes, with plastic plug ends. */
export function Jumper({ from, to, color, state }: { from: Vec3; to: Vec3; color: string; state: JumperState }) {
  const geometry = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dist = a.distanceTo(b);
    const lift = 5 + Math.min(18, dist * 0.18);
    const curve = new CatmullRomCurve3([
      a.clone().setY(4),
      a.clone().setY(lift * 0.8),
      a.clone().lerp(b, 0.5).setY(lift),
      b.clone().setY(lift * 0.8),
      b.clone().setY(4),
    ]);
    return new TubeGeometry(curve, 48, 0.55, 8, false);
    // Keyed by coordinates, not array identity: the scene model is rebuilt on every state change.
  }, [from.join(","), to.join(",")]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!material.current) return;
    material.current.emissiveIntensity = state === "current" || state === "blocked" ? 0.4 + 0.4 * Math.sin(clock.elapsedTime * 5) : state === "ok" ? 0.5 : 0;
  });

  const hex = state === "blocked" ? "#ef4444" : wireHex(color);
  const opacity = state === "ghost" ? 0.22 : 1;
  const emissive = state === "blocked" ? "#ef4444" : state === "ok" ? "#22c55e" : hex;

  return (
    <group>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial ref={material} color={hex} emissive={emissive} roughness={0.45} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      {[from, to].map((p, i) => (
        <group key={i} position={[p[0], 0, p[2]]}>
          <mesh position={[0, 2.6, 0]} raycast={() => null}>
            <boxGeometry args={[1.5, 4, 1.5]} />
            <meshStandardMaterial color="#25272b" transparent={opacity < 1} opacity={opacity} />
          </mesh>
          <mesh position={[0, 0.3, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.3, 0.3, 0.8, 6]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.8} transparent={opacity < 1} opacity={opacity} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
