// BreadPilot behaviour simulator: one run in a Node worker thread (the pipeline's checks, tests,
// npm run sim). The run itself is core.mjs; the run's data comes in workerData.

import { parentPort, workerData } from "node:worker_threads";
import { runSimulation } from "./core.mjs";

await runSimulation(workerData, (msg) => parentPort.postMessage(msg));
