// Embeddings through the OpenAI-compatible endpoint (Ollama / Docker Model Runner).
// nomic-embed-text expects task prefixes: "search_document: " for stored text and
// "search_query: " for questions; without them retrieval quality drops noticeably.

export const EMBED_DIM = 768;
const BATCH = 16;

export type Embedder = {
  documents(texts: string[]): Promise<number[][]>;
  query(text: string): Promise<number[]>;
};

export function prefixesFor(model: string): { doc: string; query: string } {
  return model.startsWith("nomic-embed") ? { doc: "search_document: ", query: "search_query: " } : { doc: "", query: "" };
}

export function openAiEmbedder(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Embedder {
  const { doc, query } = prefixesFor(model);
  const call = async (input: string[]): Promise<number[][]> => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`embeddings request failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== input.length) throw new Error(`expected ${input.length} embeddings, got ${vectors.length}`);
    for (const v of vectors) if (v.length !== EMBED_DIM) throw new Error(`${model} returned ${v.length}-dim vectors; the database expects ${EMBED_DIM}`);
    return vectors;
  };
  return {
    async documents(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) out.push(...(await call(texts.slice(i, i + BATCH).map((t) => doc + t))));
      return out;
    },
    async query(text) {
      return (await call([query + text]))[0]!;
    },
  };
}

export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
