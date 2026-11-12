import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { PICO_2_W, type BoardPin } from "@breadpilot/circuit-core";
import { labelTexture, PIN_COLORS } from "./labels";
import { PICO, PITCH } from "./coords";
import type { Target } from "./targets";

const TOP = PICO.pcbY + PICO.pcbThickness / 2;
const PCB_GREEN = "#2f9a4b";
const GOLD = "#d8ae3c";
/** Pin labels draw after everything else on the board. */
export const LABEL_RENDER_ORDER = 10;

function pinColor(p: BoardPin): string {
  if (p.type === "gpio") return p.adc !== undefined ? PIN_COLORS.adc : PIN_COLORS.gpio;
  return PIN_COLORS[p.type];
}

export interface PicoProps {
  showLabels: boolean;
  highlights: string[];
  ghost?: boolean;
  onHover(target: Target | null, e?: ThreeEvent<PointerEvent>): void;
  onClick(target: Target): void;
}

/** A plain box or cylinder on the Pico, sharing its ghost opacity (scenery: never catches the pointer). */
function Bit({ at, box, cyl, color, metal = false, opacity, rough = 0.5 }: { at: [number, number, number]; box?: [number, number, number]; cyl?: [number, number, number, number]; color: string; metal?: boolean; opacity: number; rough?: number }) {
  return (
    <mesh position={at} raycast={() => null} castShadow={opacity >= 1 && (box ? box[1] : cyl![2]) > 0.3} receiveShadow>
      {box ? <boxGeometry args={box} /> : <cylinderGeometry args={cyl} />}
      <meshStandardMaterial color={color} metalness={metal ? 0.85 : 0} roughness={metal ? 0.3 : rough} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

/**
 * The Raspberry Pi Pico 2 W, modelled on the real board (user's photos, 11/11/2026): green PCB with
 * gold castellated pads and through-holes, four mounting holes, the RP2350 chip, the silver Wi-Fi
 * shield and crystal, the white debug connector, BOOTSEL, the micro-USB socket, the on-board LED and
 * small parts near USB. Sizes are close to the real board's (21 x 51 mm), not exact.
 */
export function Pico({ showLabels, highlights, ghost = false, onHover, onClick }: PicoProps) {
  const opacity = ghost ? 0.3 : 1;
  const transparent = ghost;
  const pins = useMemo(() => PICO_2_W.pins.map((p) => ({ pin: p, pos: PICO.pinPos(p.phys) })), []);
  const silk = useMemo(() => labelTexture("Pico 2 W", PCB_GREEN, "#f4fbf5", 256, 64), []);
  const chipText = useMemo(() => labelTexture("RP2350", "#1c1e21", "#8f959c", 192, 64), []);
  const z = (dz: number) => PICO.centerZ + dz;
  const usbEnd = -PICO.length / 2;

  return (
    <group>
      {/* Black plastic header strips that sit on the breadboard */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 3.5 * PITCH, 1.25, PICO.centerZ]} raycast={() => null} castShadow={!ghost}>
          <boxGeometry args={[PITCH, 2.5, PITCH * 20]} />
          <meshStandardMaterial color="#1d1f23" transparent={transparent} opacity={opacity} />
        </mesh>
      ))}

      {/* PCB */}
      <mesh
        position={[0, PICO.pcbY, PICO.centerZ]}
        castShadow={!ghost}
        receiveShadow
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover(null);
        }}
      >
        <boxGeometry args={[PICO.width, PICO.pcbThickness, PICO.length]} />
        <meshStandardMaterial color={PCB_GREEN} roughness={0.55} transparent={transparent} opacity={opacity} />
      </mesh>

      {/* Mounting holes: gold ring, drilled through */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <Bit opacity={opacity} at={[sx * 5.7, TOP + 0.03, z(sz * 23.5)]} cyl={[2.1, 2.1, 0.06, 28]} color={GOLD} metal />
            <Bit opacity={opacity} at={[sx * 5.7, TOP + 0.05, z(sz * 23.5)]} cyl={[1.05, 1.05, 0.06, 20]} color="#0d1a12" />
          </group>
        )),
      )}

      {/* Micro-USB socket over the row-1 edge, with its opening */}
      <Bit opacity={opacity} at={[0, TOP + 1.3, PICO.centerZ + usbEnd + 2.2]} box={[8, 2.6, 5.6]} color="#c9ccd1" metal />
      <Bit opacity={opacity} at={[0, TOP + 1.25, PICO.centerZ + usbEnd - 0.62]} box={[6.4, 1.3, 0.2]} color="#15171a" />
      {/* on-board LED and the small parts by the USB socket */}
      <Bit opacity={opacity} at={[6, TOP + 0.25, PICO.centerZ + usbEnd + 2.5]} box={[1.3, 0.5, 0.9]} color="#f4f1e6" rough={0.3} />
      <Bit opacity={opacity} at={[4, TOP + 0.5, z(-12.5)]} box={[2.8, 1, 2.8]} color="#202226" />
      <Bit opacity={opacity} at={[4, TOP + 0.6, z(-8.2)]} box={[2.6, 1.2, 2.6]} color="#2a2c30" />
      <Bit opacity={opacity} at={[0.8, TOP + 0.3, z(-9.5)]} box={[1.6, 0.6, 1]} color="#c8a46a" />
      <Bit opacity={opacity} at={[0.8, TOP + 0.3, z(-7.6)]} box={[1.6, 0.6, 1]} color="#c8a46a" />
      {/* BOOTSEL: white body, cream round button */}
      <Bit opacity={opacity} at={[-3.6, TOP + 0.6, z(-11.5)]} box={[3.6, 1.2, 4.2]} color="#eceae4" rough={0.4} />
      <Bit opacity={opacity} at={[-3.6, TOP + 1.5, z(-11.5)]} cyl={[1.25, 1.25, 0.8, 20]} color="#efe3c8" rough={0.35} />
      {/* RP2350 with its name */}
      <Bit opacity={opacity} at={[0, TOP + 0.45, z(-1.5)]} box={[7, 0.9, 7]} color="#1c1e21" />
      <mesh position={[0, TOP + 0.91, z(-1.5)]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} raycast={() => null}>
        <planeGeometry args={[5, 1.7]} />
        <meshBasicMaterial map={chipText} transparent opacity={opacity} />
      </mesh>
      {/* white debug connector and the crystal, between the chip and the shield */}
      <Bit opacity={opacity} at={[0, TOP + 1.1, z(4.8)]} box={[5.4, 2.2, 2.6]} color="#f1efe9" rough={0.45} />
      <Bit opacity={opacity} at={[-5.2, TOP + 0.4, z(6.2)]} box={[2.4, 0.8, 3.2]} color="#d4d6da" metal />
      {/* Wi-Fi module under its metal shield */}
      <Bit opacity={opacity} at={[0, TOP + 0.7, z(13.5)]} box={[11, 1.4, 10]} color="#d6d8dc" metal />
      <Bit opacity={opacity} at={[0, TOP + 1.42, z(13.5)]} box={[9.6, 0.05, 8.6]} color="#e4e6e9" metal />
      {/* Printed name. Hidden while pin labels are on: it would sit under them. */}
      {!showLabels && (
        <mesh position={[0, TOP + 0.02, z(-6.3)]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} raycast={() => null}>
          <planeGeometry args={[7.5, 1.9]} />
          <meshBasicMaterial map={silk} transparent opacity={opacity} />
        </mesh>
      )}

      {pins.map(({ pin, pos }) => {
        const key = `pin:${pin.phys}`;
        const hot = highlights.includes(key);
        const target: Target = { kind: "pin", phys: pin.phys };
        const edge = pos[0] < 0 ? -PICO.width / 2 : PICO.width / 2;
        return (
          <group key={pin.phys}>
            {/* gold pad with its through-hole and the soldered pin end: the part you hover and click */}
            <mesh
              position={[pos[0], TOP + 0.05, pos[2]]}
              onPointerMove={(e) => {
                e.stopPropagation();
                onHover(target, e);
              }}
              onPointerOut={() => onHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                onClick(target);
              }}
            >
              <cylinderGeometry args={[1.05, 1.05, 0.1, 20]} />
              <meshStandardMaterial color={hot ? "#facc15" : GOLD} emissive={hot ? "#facc15" : "#000000"} emissiveIntensity={hot ? 0.8 : 0} metalness={0.9} roughness={0.3} transparent={transparent} opacity={opacity} />
            </mesh>
            <Bit opacity={opacity} at={[pos[0], TOP + 0.28, pos[2]]} cyl={[0.38, 0.55, 0.45, 12]} color="#c7cbd0" metal />
            {/* castellated half-hole on the board edge */}
            <Bit opacity={opacity} at={[edge - Math.sign(edge) * 0.45, PICO.pcbY, pos[2]]} box={[0.9, PICO.pcbThickness + 0.04, 1.3]} color={GOLD} metal />
            {showLabels && !ghost && (
              // The USB connector, chip, wireless shield and BOOTSEL button stand above the PCB and
              // used to hide labels. Labels are drawn last without a depth test, so they always
              // show on top of the Pico's parts (the labels are a reading aid, not geometry).
              <mesh
                position={[pos[0] + (pos[0] < 0 ? 4.4 : -4.4), TOP + 0.03, pos[2]]}
                rotation={[-Math.PI / 2, 0, 0]}
                raycast={() => null}
                renderOrder={LABEL_RENDER_ORDER}
              >
                <planeGeometry args={[6.2, 1.55]} />
                <meshBasicMaterial map={labelTexture(`${pin.phys} ${pin.name}`, pinColor(pin))} transparent depthTest={false} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
