import { CanvasTexture, SRGBColorSpace } from "three";

const cache = new Map<string, CanvasTexture>();

/** Text rendered to a canvas texture: no font downloads, works offline. */
export function labelTexture(text: string, bg: string, fg = "#ffffff", width = 192, height = 48): CanvasTexture {
  const key = `${text}|${bg}|${fg}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  const r = height * 0.25;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, r);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.round(height * 0.62)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2 + 1, width - 8);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Pin label colors, matching the official pinout legend. */
export const PIN_COLORS = {
  gpio: "#5aa832",
  adc: "#2f6b2a",
  ground: "#2a2d33",
  power: "#d93a3a",
  control: "#e98aa0",
  reference: "#2f6b2a",
} as const;
