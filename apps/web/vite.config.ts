import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// In dev, /api is proxied to the API running on the host (npm run dev:api).
// In the desktop app the API serves the built page itself (apps/api/src/app.ts).
// Cross-origin isolation, as the app's server sends it (apps/api/src/app.ts): the Code tab's preview
// needs SharedArrayBuffer (M8 8.C3).
// The app's version (the desktop package's), shown next to the logo.
const { version } = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as { version: string };

const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The 3D chunk (three.js + drei, ~265 kB gzipped) is lazy-loaded after the page shell.
  build: { chunkSizeWarningLimit: 1100 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
    headers: ISOLATION,
  },
  preview: { headers: ISOLATION },
  // The preview's Web Worker (packages/sim browser-worker.mjs) is an ES module: it imports MicroPython.
  worker: { format: "es" },
  // MicroPython's loader finds its .wasm by URL; pre-bundling it would move it away from that file.
  optimizeDeps: { exclude: ["@micropython/micropython-webassembly-pyscript"] },
});
