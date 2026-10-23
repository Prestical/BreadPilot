import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the API running on the host (npm run dev:api).
// In Docker, nginx does the same proxying (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  // The 3D chunk (three.js + drei, ~265 kB gzipped) is lazy-loaded after the page shell.
  build: { chunkSizeWarningLimit: 1100 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
