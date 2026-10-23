// Sidebar status in plain words, depending on the AI the user picked.
import { describe, expect, it } from "vitest";
import type { HealthReport } from "../src/health";
import { statusView } from "../src/ui/status";

const report = (llm: "ok" | "down", embed: "ok" | "down" = llm, db: "ok" | "down" = "ok"): HealthReport => ({
  status: llm === "ok" && embed === "ok" ? "ok" : "degraded",
  checks: { db: { status: db, detail: "" }, llm: { status: llm, detail: "" }, embed: { status: embed, detail: "" }, docs: { status: "ok", detail: "" } },
  version: "0",
  circuitCore: "0",
  uptimeS: 1,
});

describe("status in plain words", () => {
  it("says what to do for the AI that's picked", () => {
    expect(statusView(report("down"), false, "local")).toMatchObject({ tone: "warn", text: "Local AI is offline: start the Ollama app." });
    expect(statusView(report("down"), false, "openai")).toMatchObject({ tone: "warn", text: "Ready, but documentation search is off (start Ollama)." });
    expect(statusView(report("ok"), false, "local")).toMatchObject({ tone: "ok", text: "Ready to build" });
  });

  it("puts the server and the database first, and lists every part", () => {
    expect(statusView(null, true, "local").tone).toBe("bad");
    expect(statusView(report("ok", "ok", "down"), false, "openai").text).toBe("The projects database is offline.");
    expect(statusView(report("down"), false, "local").details).toEqual(["Projects database: OK", "Local AI (Ollama): not running", "Documentation search: offline (needs Ollama)"]);
    expect(statusView(null, false, "local").tone).toBe("pending");
  });
});
