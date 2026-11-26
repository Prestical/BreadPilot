// BreadPilot behaviour simulator: one run in a browser Web Worker (M8 8.C3a, the Code tab's preview).
// The run itself is core.mjs; the page sends the run's data in the first message (browser.ts).

import { runSimulation } from "./core.mjs";

self.addEventListener(
  "message",
  (e) => {
    runSimulation(e.data, (msg) => self.postMessage(msg)).catch((err) => {
      self.postMessage({ type: "events", events: [[0, "error", "SimulatorError", String(err?.message ?? err), String(err?.stack ?? err)]] });
      self.postMessage({ type: "done" });
    });
  },
  { once: true },
);
