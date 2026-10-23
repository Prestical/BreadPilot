import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { BREADBOARD, RAIL_IDS, type Column } from "@breadpilot/circuit-core";
import { BOARD, colX, PITCH, railX, ROWS, rowZ, type Vec3 } from "./coords";
import { targetKey, type Target } from "./targets";

interface HoleSpot {
  target: Target;
  pos: Vec3;
}

const COLUMNS = BREADBOARD.columns as Column[];

/** Every hole on the board: 63 rows × 10 columns plus 4 rails. */
function allHoles(): HoleSpot[] {
  const spots: HoleSpot[] = [];
  for (let row = 1; row <= ROWS; row++) {
    for (const col of COLUMNS) spots.push({ target: { kind: "hole", key: `${row}${col}` }, pos: [colX(col), 0, rowZ(row)] });
    for (const rail of RAIL_IDS) spots.push({ target: { kind: "rail", rail, row }, pos: [railX(rail), 0, rowZ(row)] });
  }
  return spots;
}

/** Keys of all holes electrically joined to this one (its 5-hole strip, or the whole rail). */
export function connectedKeys(t: Target): string[] {
  if (t.kind === "rail") return Array.from({ length: ROWS }, (_, i) => `${t.rail}:${i + 1}`);
  if (t.kind === "hole") {
    const m = /^(\d+)([a-j])$/.exec(t.key)!;
    const left = BREADBOARD.strips.L.includes(m[2] as Column);
    return (left ? BREADBOARD.strips.L : BREADBOARD.strips.R).map((c) => `${m[1]}${c}`);
  }
  return [];
}

const dummy = new Object3D();

function useInstances(ref: React.RefObject<InstancedMesh | null>, positions: Vec3[], y: number) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    positions.forEach((p, i) => {
      dummy.position.set(p[0], y, p[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, positions, y]);
}

export interface BreadboardProps {
  /** Strong highlight (tutorial targets, current step). */
  highlights: string[];
  onHover(target: Target | null, e?: ThreeEvent<PointerEvent>): void;
  onClick(target: Target): void;
}

export function Breadboard({ highlights, onHover, onClick }: BreadboardProps) {
  const spots = useMemo(allHoles, []);
  const byKey = useMemo(() => new Map(spots.map((s) => [targetKey(s.target), s])), [spots]);
  const [hovered, setHovered] = useState<Target | null>(null);

  const holesRef = useRef<InstancedMesh>(null);
  const pickRef = useRef<InstancedMesh>(null);
  const softRef = useRef<InstancedMesh>(null);
  const strongRef = useRef<InstancedMesh>(null);

  const allPos = useMemo(() => spots.map((s) => s.pos), [spots]);
  const softPos = useMemo(
    () => (hovered ? connectedKeys(hovered).flatMap((k) => (byKey.get(k) ? [byKey.get(k)!.pos] : [])) : []),
    [hovered, byKey],
  );
  const strongPos = useMemo(() => highlights.flatMap((k) => (byKey.get(k) ? [byKey.get(k)!.pos] : [])), [highlights, byKey]);

  useInstances(holesRef, allPos, 0.02);
  useInstances(pickRef, allPos, 0.03);
  useInstances(softRef, softPos, 0.04);
  useInstances(strongRef, strongPos, 0.05);

  const targetOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : spots[e.instanceId]!.target);

  const railLines = RAIL_IDS.map((rail) => {
    // Colored line on the outer side of the outer rail and the inner side of the inner rail.
    const left = rail.startsWith("RL");
    const plus = rail.endsWith("+");
    const x = railX(rail) + PITCH * 0.5 * (left ? (plus ? 1 : -1) : plus ? -1 : 1);
    return { rail, x, color: rail.endsWith("+") ? "#d93a3a" : "#2f6fd6" };
  });

  return (
    <group>
      {/* body */}
      <mesh position={[(BOARD.minX + BOARD.maxX) / 2, -BOARD.height / 2, (BOARD.minZ + BOARD.maxZ) / 2]}>
        <boxGeometry args={[BOARD.maxX - BOARD.minX, BOARD.height, BOARD.maxZ - BOARD.minZ]} />
        <meshStandardMaterial color="#f3f1ea" roughness={0.85} />
      </mesh>
      {/* center channel */}
      <mesh position={[0, 0.01, (BOARD.minZ + BOARD.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[PITCH * 1.4, BOARD.maxZ - BOARD.minZ]} />
        <meshStandardMaterial color="#d9d5ca" />
      </mesh>
      {railLines.map((l) => (
        <mesh key={l.rail} position={[l.x, 0.015, (BOARD.minZ + BOARD.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.35, BOARD.maxZ - BOARD.minZ - 4]} />
          <meshBasicMaterial color={l.color} />
        </mesh>
      ))}

      <instancedMesh ref={holesRef} args={[undefined, undefined, allPos.length]} raycast={() => null}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshStandardMaterial color="#3b3d42" roughness={1} />
      </instancedMesh>

      {/* Invisible, larger squares for easy picking. */}
      <instancedMesh
        ref={pickRef}
        args={[undefined, undefined, allPos.length]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const t = targetOf(e);
          if (t && (!hovered || targetKey(t) !== targetKey(hovered))) setHovered(t);
          onHover(t, e);
        }}
        onPointerOut={() => {
          setHovered(null);
          onHover(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          const t = targetOf(e);
          if (t) onClick(t);
        }}
      >
        <planeGeometry args={[PITCH * 0.95, PITCH * 0.95]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      <instancedMesh ref={softRef} args={[undefined, undefined, ROWS]} raycast={() => null}>
        <planeGeometry args={[1.8, 1.8]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={strongRef} args={[undefined, undefined, Math.max(64, highlights.length)]} raycast={() => null}>
        <planeGeometry args={[2.1, 2.1]} />
        <meshBasicMaterial color={new Color("#facc15")} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
