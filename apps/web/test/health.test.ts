import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "../src/health";

const check = { status: "ok", detail: "" };
const report = { status: "ok", checks: { db: check, llm: check, embed: check }, version: "0.0.1", circuitCore: "x", uptimeS: 1 };

function answer(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status })));
}

describe("fetchHealth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a normal report", async () => {
    answer(200, report);
    expect((await fetchHealth()).checks.db.status).toBe("ok");
  });

  it("reads the API's own 503 report (database down)", async () => {
    answer(503, { ...report, status: "down", checks: { ...report.checks, db: { status: "down", detail: "no db" } } });
    expect((await fetchHealth()).checks.db.status).toBe("down");
  });

  it("refuses a 503 without checks instead of crashing the page", async () => {
    answer(503, { error: "starting" });
    await expect(fetchHealth()).rejects.toThrow("HTTP 503");
  });

  it("refuses a 503 that isn't JSON", async () => {
    answer(503, "<html>Service Unavailable</html>");
    await expect(fetchHealth()).rejects.toThrow("HTTP 503");
  });
});
