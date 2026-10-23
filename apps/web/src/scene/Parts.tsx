import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { MeshStandardMaterial } from "three";
import type { ResolvedPart } from "@breadpilot/circuit-core";
import { labelTexture } from "./labels";
import { Rod } from "./Rod";
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
  const render = (n: ShapeNode, key: number): React.ReactNode => {
    switch (n.node) {
      case "rod":
        return <Rod key={key} from={n.from} to={n.to} opacity={n.opacity} />;
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
          <mesh key={key} {...defined({ position: n.position, rotation: n.rotation })} {...(n.noRaycast ? { raycast: () => null } : {})}>
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
