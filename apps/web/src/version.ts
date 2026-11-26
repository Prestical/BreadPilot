// The app's version, from apps/desktop/package.json (put in by Vite at build time: vite.config.ts).
declare const __APP_VERSION__: string | undefined;

/** "0.4.0-beta.1"; "dev" where Vite didn't put it in (tests). */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
