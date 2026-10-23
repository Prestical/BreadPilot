import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { PICO_2_W, type BoardPin } from "@breadpilot/circuit-core";
import { labelTexture, PIN_COLORS } from "./labels";
import { PICO, PITCH } from "./coords";
import type { Target } from "./targets";

const TOP = PICO.pcbY + PICO.pcbThickness / 2;
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

export function Pico({ showLabels, highlights, ghost = false, onHover, onClick }: PicoProps) {
  const opacity = ghost ? 0.3 : 1;
  const transparent = ghost;
  const pins = useMemo(() => PICO_2_W.pins.map((p) => ({ pin: p, pos: PICO.pinPos(p.phys) })), []);
  const title = useMemo(() => labelTexture("Raspberry Pi Pico 2 W", "#0f5a2c", "#e8f5ec", 512, 64), []);

  return (
    <group>
      {/* Black plastic header strips that sit on the breadboard */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 3.5 * PITCH, 1.25, PICO.centerZ]} raycast={() => null}>
          <boxGeometry args={[PITCH, 2.5, PITCH * 20]} />
          <meshStandardMaterial color="#1d1f23" transparent={transparent} opacity={opacity} />
        </mesh>
      ))}

      {/* PCB */}
      <mesh
        position={[0, PICO.pcbY, PICO.centerZ]}
        onPointerMove={(e) => {
          e.stopPropagation();
          onHover(null);
        }}
      >
        <boxGeometry args={[PICO.width, PICO.pcbThickness, PICO.length]} />
        <meshStandardMaterial color="#1b7a3d" roughness={0.6} transparent={transparent} opacity={opacity} />
      </mesh>

      {/* Micro-USB connector (overhangs the row-1 edge) */}
      <mesh position={[0, TOP + 1.4, PICO.centerZ - PICO.length / 2 + 2.2]} raycast={() => null}>
        <boxGeometry args={[8, 2.8, 5.6]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} transparent={transparent} opacity={opacity} />
      </mesh>
      {/* RP2350 */}
      <mesh position={[0, TOP + 0.45, PICO.centerZ + 1]} raycast={() => null}>
        <boxGeometry args={[7, 0.9, 7]} />
        <meshStandardMaterial color="#222428" roughness={0.5} transparent={transparent} opacity={opacity} />
      </mesh>
      {/* Wireless module (metal shield) */}
      <mesh position={[0, TOP + 0.7, PICO.centerZ + 13]} raycast={() => null}>
        <boxGeometry args={[11, 1.4, 10]} />
        <meshStandardMaterial color="#d6d8dc" metalness={0.85} roughness={0.25} transparent={transparent} opacity={opacity} />
      </mesh>
      {/* BOOTSEL button */}
      <mesh position={[-4.5, TOP + 0.9, PICO.centerZ - 13]} raycast={() => null}>
        <cylinderGeometry args={[1.5, 1.5, 1.8, 16]} />
        <meshStandardMaterial color="#f2f2f2" transparent={transparent} opacity={opacity} />
      </mesh>
      {/* Name, printed near the antenna end. Hidden while pin labels are on: it sits under the
          labels of pins 19-22. */}
      {!showLabels && <mesh position={[0, TOP + 0.02, PICO.centerZ + 22.5]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[18, 2.25]} />
        <meshBasicMaterial map={title} transparent opacity={opacity} />
      </mesh>}

      {pins.map(({ pin, pos }) => {
        const key = `pin:${pin.phys}`;
        const hot = highlights.includes(key);
        const target: Target = { kind: "pin", phys: pin.phys };
        return (
          <group key={pin.phys}>
            <mesh
              position={[pos[0], TOP + 0.6, pos[2]]}
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
              <boxGeometry args={[1.5, 1.2, 1.5]} />
              <meshStandardMaterial
                color={hot ? "#facc15" : "#d4a72c"}
                emissive={hot ? "#facc15" : "#000000"}
                emissiveIntensity={hot ? 0.8 : 0}
                metalness={0.9}
                roughness={0.3}
                transparent={transparent}
                opacity={opacity}
              />
            </mesh>
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
