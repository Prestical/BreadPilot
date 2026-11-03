// The desktop app's engine runs in an Electron utility process, where pdfjs didn't recognise Node
// and every PDF failed with 'No "GlobalWorkerOptions.workerSrc" specified' (the docs were never
// indexed). Simulated here: process.type "utility" before extract.ts loads.
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const proc = process as unknown as { type?: string };
const before = { type: proc.type, electron: process.versions.electron };
proc.type = "utility";
(process.versions as Record<string, string>).electron ??= "44.10.1";
afterAll(() => {
  proc.type = before.type;
  if (before.electron === undefined) delete (process.versions as Record<string, string | undefined>).electron;
});

describe("PDF text inside the desktop app's engine", () => {
  it("extracts the real datasheet", async () => {
    const { extractPdf } = await import("../src/rag/extract");
    const pages = await extractPdf(resolve(REPO, "docs/hardware/pico-2-w/pico-2-w-datasheet.pdf"));
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.flatMap((p) => p.lines).join(" ")).toMatch(/Pico 2 W/);
  }, 60_000);
});
