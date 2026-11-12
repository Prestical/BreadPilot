// The room around the breadboard: lights, the reflections metal parts pick up, the wooden desk and
// the cutting mat the board lies on. Everything is made at run time (no image or HDR files), so it
// works offline.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { BOARD } from "./coords";
import { MAT, matTexture, woodTexture } from "./textures";

/** Desk top size in mm (x across, z toward the user) and where its top surface is. */
export const DESK = { width: 780, depth: 540, thickness: 28, centerZ: 6, topY: -BOARD.height - MAT.thickness };

/**
 * Lights for the workbench and the part previews. `shadows`: the main light casts real shadows
 * (the workbench); the small previews leave them out.
 */
export function StudioLights({ dark, shadows = false }: { dark: boolean; shadows?: boolean }) {
  return (
    <>
      <hemisphereLight args={["#ffffff", "#8a8f99", dark ? 1.25 : 1.05]} />
      {/* Main light: from the front right, above, like a desk lamp. */}
      <directionalLight position={[70, 180, 95]} intensity={2.1} castShadow={shadows} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.3} shadow-radius={3}>
        <orthographicCamera attach="shadow-camera" args={[-190, 190, 170, -170, 20, 520]} />
      </directionalLight>
      <directionalLight position={[-80, 90, -60]} intensity={0.5} />
      {/* What shiny metal reflects: a big soft lamp above, a window on the left, a dim room. */}
      <Environment resolution={128} frames={1} environmentIntensity={dark ? 0.45 : 0.55}>
        <color attach="background" args={[dark ? "#3a3f4a" : "#6f757f"]} />
        <Lightformer form="rect" intensity={3} position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[9, 7, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-7, 2.5, 0]} rotation-y={Math.PI / 2} scale={[7, 3.5, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[6, 2, 4]} rotation-y={-Math.PI / 3} scale={[4, 2.5, 1]} color="#ffe9c9" />
      </Environment>
    </>
  );
}

/**
 * Draws the shadow map only when what stands on the board changes (`drawKey`), not every frame:
 * nothing in the scene moves by itself, so the camera can turn at no extra cost.
 */
export function ShadowsOnChange({ drawKey }: { drawKey: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    // Once more after the new parts' geometry is on the GPU.
    const again = setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    }, 120);
    return () => clearTimeout(again);
  }, [gl, invalidate, drawKey]);
  return null;
}

/** The wooden desk top and the green cutting mat under the breadboard. Scenery: never catches the pointer. */
export function Desk({ dark }: { dark: boolean }) {
  const matY = DESK.topY + MAT.thickness;
  return (
    <group>
      <mesh position={[0, DESK.topY - DESK.thickness / 2, DESK.centerZ]} receiveShadow raycast={() => null}>
        <boxGeometry args={[DESK.width, DESK.thickness, DESK.depth]} />
        <meshStandardMaterial map={woodTexture(dark)} roughness={0.55} metalness={0} />
      </mesh>
      {/* cutting mat: a dark green slab with its printed top */}
      <mesh position={[0, DESK.topY + MAT.thickness / 2 - 0.1, DESK.centerZ]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[MAT.width, MAT.thickness - 0.2, MAT.depth]} />
        <meshStandardMaterial color="#245c47" roughness={0.9} />
      </mesh>
      <mesh position={[0, matY, DESK.centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[MAT.width, MAT.depth]} />
        <meshStandardMaterial map={matTexture()} roughness={0.85} />
      </mesh>
    </group>
  );
}
