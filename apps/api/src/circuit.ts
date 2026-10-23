import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CATALOG,
  formatWire,
  getBoard,
  parseConnections,
  validateBuild,
  type Build,
  type GpioMode,
  type Issue,
} from "@breadpilot/circuit-core";

const PartSchema = z.object({
  ref: z.string().min(1).max(32),
  type: z.string().min(1).max(64),
  legs: z.record(z.string().max(16), z.string().max(8)),
  props: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const ValidateBodySchema = z.object({
  boardId: z.string().default("pico-2-w"),
  parts: z.array(PartSchema).max(100).default([]),
  /** Connection DSL, one connection per line. */
  connections: z.string().max(20_000).default(""),
  gpioModes: z.record(z.string().max(8), z.string().max(16)).default({}),
});

export function registerCircuitRoutes(app: FastifyInstance) {
  app.post("/api/validate", async (req, reply) => {
    const parsed = ValidateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;
    const board = getBoard(body.boardId);
    if (!board) return reply.status(404).send({ code: "NOT_FOUND", message: `Unknown board "${body.boardId}"` });

    const dsl = parseConnections(body.connections, board);
    const build: Build = {
      boardId: body.boardId,
      parts: body.parts,
      wires: dsl.wires,
      gpioModes: body.gpioModes as Record<string, GpioMode>,
    };
    const report = validateBuild(build);
    const syntax: (Issue & { line: number })[] = dsl.errors.map((e) => ({
      code: "E006",
      severity: "error",
      message: `Line ${e.line}: ${e.message}`,
      line: e.line,
    }));
    const issues = [...syntax, ...report.issues];
    const errors = issues.filter((i) => i.severity === "error").length;
    return {
      ok: errors === 0,
      errors,
      warnings: issues.length - errors,
      issues,
      connections: dsl.wires.map((w, i) => ({ line: dsl.lines[i], dsl: formatWire(w) })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/boards/:id", async (req, reply) => {
    const board = getBoard(req.params.id);
    if (!board) return reply.status(404).send({ code: "NOT_FOUND", message: `Unknown board "${req.params.id}"` });
    return board;
  });

  app.get("/api/components", async () => Object.values(CATALOG));
}
