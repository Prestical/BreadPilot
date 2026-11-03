// Development server: npm run dev:api (API on http://127.0.0.1:3000; npm run dev:web serves the
// page). Data in .local/data with a development key. The desktop app starts the API through
// desktop.ts instead.
import { loadConfig } from "./config";
import { devKey, openDataDir } from "./datadir";
import { defaultSettings, memorySettings } from "./settings";
import { startApi } from "./start";

const config = loadConfig();
const data = await openDataDir({ dir: config.DATA_DIR, key: await devKey(config.DATA_DIR), onError: (err) => console.error("saving the database failed:", err) });
let api: Awaited<ReturnType<typeof startApi>>;
try {
  // Development: AI settings start from .env; changes made in the page last until the server stops.
  const settings = memorySettings(defaultSettings(config, { withKey: true, setupDone: true }));
  api = await startApi({ config, db: data.db, settings, port: config.API_PORT, webDir: config.WEB_DIR || undefined, logger: true });
} catch (err) {
  console.error("startup failed:", err);
  await data.close().catch(() => {});
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    api.app.log.info(`${signal} received, shutting down`);
    await api.close();
    await data.close();
    process.exit(0);
  });
}
