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

/** Where the wire leaves its plug, above the board (mm). */
export const PLUG_TOP = 7;

/**
 * A jumper wire arcing between two holes. Each end is a real jumper's plug: the metal pin in the
 * hole, the black moulded grip and the short sleeve where the wire comes out. `lift`: arc height
 * (wireLifts); the whole arc starts at the top of the plugs.
 */
export function Jumper({ from, to, color, state, lift: given }: { from: Vec3; to: Vec3; color: string; state: JumperState; lift?: number }) {
  const geometry = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dist = a.distanceTo(b);
    const lift = given ?? 5 + Math.min(18, dist * 0.18);
    // The same arc as before the plugs were modelled, moved up by the plug's height, so wires that
    // cross keep the clearances wireLifts gave them.
    const up = PLUG_TOP - 4;
    const curve = new CatmullRomCurve3([
      a.clone().setY(PLUG_TOP - 0.6),
      a.clone().setY(lift * 0.8 + up),
      a.clone().lerp(b, 0.5).setY(lift + up),
      b.clone().setY(lift * 0.8 + up),
      b.clone().setY(PLUG_TOP - 0.6),
    ]);
    return new TubeGeometry(curve, 56, 0.55, 10, false);
    // Keyed by coordinates, not array identity: the scene model is rebuilt on every state change.
  }, [from.join(","), to.join(","), given]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!material.current) return;
    material.current.emissiveIntensity = state === "current" || state === "blocked" ? 0.4 + 0.4 * Math.sin(clock.elapsedTime * 5) : state === "ok" ? 0.5 : 0;
  });

  const hex = state === "blocked" ? "#ef4444" : wireHex(color);
  const opacity = state === "ghost" ? 0.22 : 1;
  const emissive = state === "blocked" ? "#ef4444" : state === "ok" ? "#22c55e" : hex;
  const solid = opacity >= 1;
  const plastic = <meshStandardMaterial color="#25272b" roughness={0.5} transparent={!solid} opacity={opacity} />;

  return (
    <group>
      <mesh geometry={geometry} raycast={() => null} castShadow={solid}>
        <meshStandardMaterial ref={material} color={hex} emissive={emissive} roughness={0.45} transparent={!solid} opacity={opacity} />
      </mesh>
      {[from, to].map((p, i) => (
        <group key={i} position={[p[0], 0, p[2]]}>
          {/* grip */}
          <mesh position={[0, 3.2, 0]} raycast={() => null} castShadow={solid}>
            <cylinderGeometry args={[1.05, 0.95, 4.6, 14]} />
            {plastic}
          </mesh>
          {/* sleeve narrowing to the wire */}
          <mesh position={[0, 6.2, 0]} raycast={() => null} castShadow={solid}>
            <cylinderGeometry args={[0.62, 1.05, 1.4, 14]} />
            {plastic}
          </mesh>
          {/* metal pin going into the hole */}
          <mesh position={[0, 0.5, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.3, 0.3, 1.2, 8]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.8} roughness={0.35} transparent={!solid} opacity={opacity} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
