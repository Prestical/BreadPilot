import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

let app: FastifyInstance;
beforeEach(() => {
  app = buildApp({
    health: { checkDb: async () => ({ status: "ok", detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" },
  });
});
afterEach(async () => {
  await app.close();
});

const validate = (payload: unknown) => app.inject({ method: "POST", url: "/api/validate", payload: payload as object });

const LED_CIRCUIT = {
  parts: [
    { ref: "R1", type: "resistor", legs: { a: "30h", b: "33h" } },
    { ref: "LED1", type: "led-5mm", legs: { anode: "33g", cathode: "34g" } },
  ],
  connections: "#21(GP16) -> #30j(R1.a)\n#34j(LED1.cathode) -> #38(GND)",
  gpioModes: { GP16: "out" },
};

describe("POST /api/validate", () => {
  it("accepts a safe circuit", async () => {
    const res = await validate(LED_CIRCUIT);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, errors: 0, warnings: 0, issues: [] });
    expect(res.json().connections).toEqual([
      { line: 1, dsl: "#21(GP16) -> #30j(R1.a)" },
      { line: 2, dsl: "#34j(LED1.cathode) -> #38(GND)" },
    ]);
  });

  it("reports a short circuit", async () => {
    const res = await validate({ connections: "#36(3V3) -> #38(GND)" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.issues[0]).toMatchObject({ code: "E001", severity: "error" });
  });

  it("reports DSL syntax errors with line numbers", async () => {
    const res = await validate({ connections: "#38(GND) -> #RR-\n#33 -> #10a" });
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.issues[0]).toMatchObject({ code: "E006", line: 2 });
  });

  it("returns 400 for a malformed body", async () => {
    const res = await validate({ parts: "not-an-array" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("BAD_REQUEST");
  });

  it("returns 404 for an unknown board", async () => {
    const res = await validate({ boardId: "arduino-uno" });
    expect(res.statusCode).toBe(404);
  });
});

describe("ground-truth endpoints", () => {
  it("GET /api/boards/pico-2-wh returns the Pico 2 W data (same board)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/boards/pico-2-wh" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("pico-2-w");
    expect(res.json().pins).toHaveLength(40);
  });

  it("GET /api/boards/unknown is 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/boards/nope" })).statusCode).toBe(404);
  });

  it("GET /api/components lists the catalog", async () => {
    const ids = (await app.inject({ method: "GET", url: "/api/components" })).json().map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["led-5mm", "resistor", "button-6mm", "potentiometer"]));
  });
});
