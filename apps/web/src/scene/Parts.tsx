import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { CurvePath, LatheGeometry, LineCurve3, QuadraticBezierCurve3, TubeGeometry, Vector2, Vector3, type Curve, type MeshStandardMaterial } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ResolvedPart } from "@breadpilot/circuit-core";
import { labelTexture } from "./labels";
import { Rod } from "./Rod";
import type { Vec3 } from "./coords";
import { partShapes, type Geometry, type ItemState, type Material, type ShapeNode } from "./shapes";

export type { ItemState } from "./shapes";

export interface PartViewProps {
  part: ResolvedPart;
  state: ItemState;
  lit?: boolean;
  onHover(ref: string | null, e?: ThreeEvent<PointerEvent>): void;
}

/** Pulses the current item so beginners can spot it. */
function usePulse(state: ItemState) {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = state === "current" ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 4) : 0;
  });
  return ref;
}

function hoverProps(ref: string, onHover: PartViewProps["onHover"]) {
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(ref, e);
    },
    onPointerOut: () => onHover(null),
  };
}

/** Leaves out unset props, so three.js keeps its own defaults (as when the prop isn't written). */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Renders a part from its shape data (scene/shapes.ts). */
export function PartView({ part, state, lit = false, onHover }: PartViewProps) {
  const pulse = usePulse(state);
  const tree = useMemo(() => partShapes(part, state, lit), [part, state, lit]);
  // Parts not placed yet (ghosts) cast no shadow.
  const solid = state !== "ghost";
  const render = (n: ShapeNode, key: number): React.ReactNode => {
    switch (n.node) {
      case "rod":
        return <Rod key={key} from={n.from} to={n.to} opacity={n.opacity} />;
      case "lead":
        return <Lead key={key} points={n.points} radius={n.radius} bend={n.bend} opacity={n.opacity} />;
      case "light":
        return <pointLight key={key} color={n.color} intensity={n.intensity} distance={n.distance} />;
      case "group":
        return (
          <group key={key} {...defined({ position: n.position, rotation: n.rotation })} {...(n.hover ? hoverProps(part.ref, onHover) : {})}>
            {n.children.map(render)}
          </group>
        );
      case "mesh":
        return (
          <mesh key={key} castShadow={solid && n.geometry.type !== "plane"} receiveShadow {...defined({ position: n.position, rotation: n.rotation })} {...(n.noRaycast ? { raycast: () => null } : {})}>
            <GeometryView g={n.geometry} />
            <MaterialView m={n.material} pulse={n.pulse ? pulse : undefined} />
          </mesh>
        );
    }
  };
  return <>{render(tree, 0)}</>;
}

function GeometryView({ g }: { g: Geometry }) {
  switch (g.type) {
    case "box":
      return <boxGeometry args={g.args} />;
    case "roundedBox":
      return <RoundedBox args={g.args} />;
    case "lathe":
      return <Lathe points={g.points} segments={g.args[0]} />;
    case "cylinder":
      return <cylinderGeometry args={g.args} />;
    case "sphere":
      return <sphereGeometry args={g.args} />;
    case "capsule":
      return <capsuleGeometry args={g.args} />;
    case "plane":
      return <planeGeometry args={g.args} />;
  }
}

function MaterialView({ m, pulse }: { m: Material; pulse?: React.Ref<MeshStandardMaterial> }) {
  const map = m.map ? labelTexture(m.map.text, m.map.bg, m.map.fg, m.map.width, m.map.height) : undefined;
  if (m.kind === "basic") return <meshBasicMaterial map={map} transparent={m.transparent} opacity={m.opacity} />;
  const { kind: _, map: __, ...props } = m;
  return <meshStandardMaterial ref={pulse} {...defined(props)} />;
}

function RoundedBox({ args: [w, h, d, r] }: { args: [number, number, number, number] }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(w, h, d, 3, r), [w, h, d, r]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/** A profile spun around the y axis. Built once per profile, not on every render. */
function Lathe({ points, segments }: { points: [number, number][]; segments: number }) {
  const key = points.flat().join(",");
  const geometry = useMemo(() => new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments), [key, segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

/** The path of a bent lead: straight runs joined by small rounded corners. */
export function leadPath(points: Vec3[], bend: number): Curve<Vector3> {
  const pts = points.map((p) => new Vector3(...p));
  const path = new CurvePath<Vector3>();
  let from = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const corner = pts[i]!;
    const next = pts[i + 1];
    if (!next) {
      path.add(new LineCurve3(from, corner));
      break;
    }
    // The corner never takes more than half of either run.
    const r = Math.min(bend, from.distanceTo(corner) / 2, corner.distanceTo(next) / 2);
    const before = corner.clone().add(from.clone().sub(corner).setLength(r));
    const after = corner.clone().add(next.clone().sub(corner).setLength(r));
    path.add(new LineCurve3(from, before));
    path.add(new QuadraticBezierCurve3(before, corner, after));
    from = after;
  }
  return path;
}

/** A bent metal lead (a resistor's wire, a button's leg). */
function Lead({ points, radius, bend, opacity }: { points: Vec3[]; radius: number; bend: number; opacity: number }) {
  const key = points.flat().join(",");
  const geometry = useMemo(() => new TubeGeometry(leadPath(points, bend), points.length * 10, radius, 8, false), [key, radius, bend]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow={opacity >= 1} raycast={() => null}>
      <meshStandardMaterial color="#b8bcc4" metalness={0.7} roughness={0.35} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}
