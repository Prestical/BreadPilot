// Model sheet: one part (or a few, laid out by the real engine) from four fixed angles, with its
// measured size, so a new 3D model can be checked by eye before it goes into the app. A developer
// tool, never shipped (the app's build is apps/web/dist; this one goes to apps/web/.model-sheet).
//
//   npm run model-sheet -w @breadpilot/web
//   then open apps/web/.model-sheet/index.html#kinds=ldr          (a part kind from parts/)
//                                            #kinds=dht22,oled,buzzer  (neighbours, as laid out)
//                                            #model=hall-sensor        (a model in upcoming.ts)
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { layoutProject, PACKS, packByKind, resolveBuild, type ResolvedPart, type Column } from "@breadpilot/circuit-core";
import { BOARD, holePos, PITCH, rowZ, type Vec3 } from "../../src/scene/coords";
import { ShapeTree } from "../../src/scene/Parts";
import { viewShapes, partShapes } from "../../src/scene/shapes";
import { StudioLights } from "../../src/scene/Studio";
import { overlap, shapeBounds, type Box3 } from "../../src/scene/bounds";
import { UPCOMING_MODELS, upcomingPart } from "../../src/scene/upcoming";

const COLS: Column[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

interface Item {
  part: ResolvedPart;
  tree: ReturnType<typeof partShapes>;
  block: string;
}

function read(): { items: Item[]; title: string; blocks: { ref: string; kind: string; rows: [number, number] }[] } {
  const hash = new URLSearchParams(location.hash.slice(1));
  const model = hash.get("model");
  if (model) {
    const m = UPCOMING_MODELS.find((x) => x.id === model);
    if (!m) throw new Error(`No model "${model}" in upcoming.ts`);
    const part = upcomingPart(m);
    return { items: [{ part, tree: viewShapes(m.view, part, "done"), block: m.id }], title: `${m.name} (upcoming.ts)`, blocks: [] };
  }
  const kinds = (hash.get("kinds") ?? "led").split(",").filter(Boolean);
  for (const k of kinds) if (!packByKind(k)) throw new Error(`No part kind "${k}". Kinds: ${PACKS.flatMap((p) => p.meta.kind ?? []).join(", ")}`);
  const lay = layoutProject(kinds.map((kind) => ({ kind })));
  const parts = resolveBuild(lay.build).resolved!.parts;
  const items = lay.blocks.flatMap((b) => b.refs.map((ref) => {
    const part = parts.find((p) => p.ref === ref)!;
    return { part, tree: partShapes(part, "done"), block: b.ref };
  }));
  return { items, title: kinds.join(" + "), blocks: lay.blocks.map((b) => ({ ref: b.ref, kind: b.kind, rows: b.rows })) };
}

/**
 * Draws a few frames by hand: a hidden browser tab (an agent's browser pane) runs no animation
 * frames, so a scene waiting for them would stay empty.
 */
function DrawNow({ at }: { at: Vec3 }) {
  const { advance, camera } = useThree();
  useEffect(() => {
    camera.lookAt(at[0], at[1], at[2]);
    const timers = [50, 400, 1200, 2500, 4000].map((ms) => setTimeout(() => advance(performance.now() / 1000), ms));
    return () => timers.forEach(clearTimeout);
  }, [advance, camera, at]);
  return null;
}

const join = (a: Box3 | null, b: Box3): Box3 => (a ? { min: a.min.map((v, i) => Math.min(v, b.min[i]!)) as Vec3, max: a.max.map((v, i) => Math.max(v, b.max[i]!)) as Vec3 } : b);
const mm = (v: number) => v.toFixed(1);

function Sheet() {
  const { items, title, blocks } = read();
  const all = items.reduce<Box3 | null>((acc, it) => join(acc, shapeBounds(it.tree, { legs: true })!), null)!;
  const center: Vec3 = [(all.min[0] + all.max[0]) / 2, (all.min[1] + all.max[1]) / 2, (all.min[2] + all.max[2]) / 2];
  const size = Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2], 12) * 1.9;
  // Rows and columns of holes under the parts, so legs can be checked against the grid.
  const rows = Array.from({ length: 64 }, (_, i) => i + 1).filter((r) => rowZ(r) > all.min[2] - 8 && rowZ(r) < all.max[2] + 8);
  const views: { name: string; camera: Vec3; up?: Vec3 }[] = [
    { name: "Front, from the right (the app's preview angle)", camera: [center[0] + size * 0.55, size * 0.8, center[2] + size * 0.9] },
    { name: "From the channel side", camera: [center[0] - size * 0.75, size * 0.55, center[2] + size * 0.75] },
    { name: "Top (rows run down the picture)", camera: [center[0], size * 1.5, center[2] + 0.01] },
    { name: "Side, along the rows (checks reach)", camera: [center[0] + size * 1.35, center[1] + size * 0.12, center[2]] },
  ];
  // Measurements: each block's body against its rows, and blocks that go through each other.
  const byBlock = new Map<string, Box3>();
  for (const it of items) byBlock.set(it.block, join(byBlock.get(it.block) ?? null, shapeBounds(it.tree)!));
  const report = blocks.map((b) => {
    const box = byBlock.get(b.ref)!;
    const reach = packByKind(b.kind)?.layout?.reach ?? [0, 0];
    const before = (rowZ(b.rows[0]) - box.min[2]) / PITCH;
    const after = (box.max[2] - rowZ(b.rows[1])) / PITCH;
    const ok = before <= reach[0] + 1e-6 && after <= reach[1] + 1e-6;
    return `${b.ref} (${b.kind}) rows ${b.rows[0]}-${b.rows[1]}: body ${mm(box.max[0] - box.min[0])} x ${mm(box.max[1] - box.min[1])} x ${mm(box.max[2] - box.min[2])} mm (across x up x along); reaches ${before.toFixed(2)} rows before, ${after.toFixed(2)} after; declared reach [${reach.join(", ")}] ${ok ? "OK" : "TOO SMALL"}`;
  });
  const hits: string[] = [];
  const keys = [...byBlock.keys()];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (overlap(byBlock.get(keys[i]!)!, byBlock.get(keys[j]!)!).every((v) => v > 0.05)) hits.push(`${keys[i]} x ${keys[j]}`);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 12, background: "#eef0f3", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>{title}</h1>
      <pre id="report" style={{ fontSize: 12, margin: "0 0 8px", whiteSpace: "pre-wrap" }}>
        {[...report, hits.length ? `COLLISIONS: ${hits.join(", ")}` : blocks.length > 1 ? "No collisions between blocks." : ""].filter(Boolean).join("\n")}
      </pre>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {views.map((v) => (
          <figure key={v.name} style={{ margin: 0, background: "#fff", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ height: 380 }}>
              <Canvas frameloop="never" dpr={2} gl={{ preserveDrawingBuffer: true }} camera={{ fov: 30, position: v.camera, near: 0.5, far: 4000 }}>
                <DrawNow at={[center[0], center[1] * 0.6, center[2]]} />
                <StudioLights dark={false} />
                {/* the breadboard at its real width, and the mat it lies on (parts on wires lie there) */}
                <mesh position={[0, -BOARD.height / 2, center[2]]}>
                  <boxGeometry args={[BOARD.maxX * 2, BOARD.height, Math.max(70, size * 1.6)]} />
                  <meshStandardMaterial color="#f3f1ea" roughness={0.85} />
                </mesh>
                <mesh position={[center[0], -BOARD.height - 1, center[2]]}>
                  <boxGeometry args={[Math.max(140, size * 2), 2, Math.max(140, size * 2)]} />
                  <meshStandardMaterial color="#2c6e55" roughness={0.9} />
                </mesh>
                {rows.flatMap((r) => COLS.map((c) => {
                  const p = holePos({ row: r, col: c });
                  return (
                    <mesh key={`${r}${c}`} position={[p[0], 0.01, p[2]]}>
                      <boxGeometry args={[1.1, 0.02, 1.1]} />
                      <meshStandardMaterial color="#3a3d43" />
                    </mesh>
                  );
                }))}
                <ContactShadows frames={1} position={[center[0], 0.03, center[2]]} scale={size * 1.4} resolution={512} blur={1.6} far={30} opacity={0.4} />
                {items.map((it) => (
                  <ShapeTree key={it.part.ref} tree={it.tree} state="done" />
                ))}
              </Canvas>
            </div>
            <figcaption style={{ fontSize: 12, padding: "4px 8px" }}>{v.name}</figcaption>
          </figure>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "#555" }}>Breadboard: {BOARD.maxX.toFixed(1)} mm to each side of the centre; hole pitch {PITCH} mm.</p>
    </div>
  );
}

function App() {
  try {
    return <Sheet />;
  } catch (e) {
    return <pre style={{ color: "#b00", padding: 12 }}>{String((e as Error).message)}</pre>;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
window.addEventListener("hashchange", () => location.reload());
