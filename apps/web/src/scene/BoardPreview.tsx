// One board on its own, in 3D, for the parts dialog: standing in a piece of breadboard. Drag to turn it.
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { boardPlace, boardShapes, type BoardModel } from "./boards";
import { BOARD } from "./coords";
import { ShapeTree } from "./Parts";
import { StudioLights } from "./Studio";
import { useDark } from "../ui/theme";

export default function BoardPreview({ board }: { board: BoardModel }) {
  const tree = useMemo(() => boardShapes(board, "done"), [board]);
  const { center } = useMemo(() => boardPlace(board), [board]);
  const size = Math.max(...board.size) * 1.5 + 20;
  const dark = useDark();
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 35, position: [center[0] + size * 0.5, size * 0.85, center[2] + size * 0.85] }} aria-label={`3D view of ${board.name}`} role="img">
      <StudioLights dark={dark} />
      {/* the piece of breadboard under the board, as wide as a real one */}
      <mesh position={[0, -1, center[2]]} raycast={() => null}>
        <boxGeometry args={[BOARD.maxX - BOARD.minX, 2, board.size[1] + 14]} />
        <meshStandardMaterial color="#f3f1ea" roughness={0.85} />
      </mesh>
      <ContactShadows frames={1} position={[center[0], 0.02, center[2]]} scale={size} resolution={512} blur={1.6} far={20} opacity={0.45} />
      <ShapeTree tree={tree} state="done" />
      <OrbitControls target={[center[0], 3, center[2]]} enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
