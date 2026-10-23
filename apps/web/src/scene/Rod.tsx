import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import type { Vec3 } from "./coords";

const UP = new Vector3(0, 1, 0);

/** Thin cylinder between two points (part legs). */
export function Rod({ from, to, radius = 0.25, color = "#b8bcc4", opacity = 1 }: { from: Vec3; to: Vec3; radius?: number; color?: string; opacity?: number }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(UP, dir.normalize()),
      length: len,
    };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.35} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}
