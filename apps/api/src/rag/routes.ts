import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RagService } from "./service";

const SearchBody = z.object({
  query: z.string().trim().min(2).max(500),
  board: z.string().max(64).optional(),
  k: z.number().int().min(1).max(20).default(5),
});

export function registerRagRoutes(app: FastifyInstance, rag: RagService) {
  app.post("/api/rag/search", async (req, reply) => {
    const parsed = SearchBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid request body", details: parsed.error.issues });
    const { query, board, k } = parsed.data;
    return rag.search(query, { k, ...(board ? { board } : {}) });
  });

  app.get("/api/rag/documents", async () => rag.documents());

  app.post<{ Querystring: { force?: string } }>("/api/rag/reindex", async (req) => rag.reindex(req.query.force === "true"));
}
