import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { chunkMarkdown, splitSentences, type Chunk } from "../src/rag/chunk";
import { openAiEmbedder, prefixesFor, toVectorLiteral } from "../src/rag/embed";
import { isGarbageLine } from "../src/rag/extract";
import { chunkSource, discoverSources } from "../src/rag/ingest";
import { citationOf, FULLTEXT_SQL, hybridSearch, rrf, VECTOR_SQL } from "../src/rag/search";
import type { RagService } from "../src/rag/service";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

describe("source discovery", () => {
  it("finds the Pico 2 W PDFs, the part datasheets and the generated pinout text", async () => {
    const sources = await discoverSources(REPO);
    expect(sources.map((s) => [s.path, s.board, s.title, s.kind])).toEqual([
      ["docs/hardware/components/SH1106.pdf", "components", "SH1106 datasheet", "pdf"],
      ["docs/hardware/pico-2-w/pico-2-w-datasheet.pdf", "pico-2-w", "Raspberry Pi Pico 2 W datasheet", "pdf"],
      ["docs/hardware/pico-2-w/pico-2-w-pinout.pdf", "pico-2-w", "Raspberry Pi Pico 2 W pinout", "pdf"],
      ["data/boards/pico-2-w.pinout.generated.md", "pico-2-w", "Raspberry Pi Pico 2 W pinout (verified data)", "markdown"],
    ]);
  });
});

describe("source discovery with .ragignore", () => {
  it("leaves out the files a folder's .ragignore lists", async () => {
    const repo = await mkdtemp(join(tmpdir(), "breadpilot-ragignore-"));
    try {
      const dir = join(repo, "docs", "hardware", "components");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "KEEP.pdf"), "%PDF-1.4");
      await writeFile(join(dir, "OTHER.pdf"), "%PDF-1.4");
      await writeFile(join(dir, ".ragignore"), "# a different chip\nOTHER.pdf\n");
      expect((await discoverSources(repo)).map((s) => s.path)).toEqual(["docs/hardware/components/KEEP.pdf"]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("chunking the real documents", () => {
  let corpus: Chunk[] = [];
  let datasheet: Chunk[] = [];

  beforeAll(async () => {
    const sources = await discoverSources(REPO);
    for (const s of sources) {
      const c = await chunkSource(s);
      if (Array.isArray(c)) corpus.push(...c);
      if (s.path.endsWith("datasheet.pdf") && Array.isArray(c)) datasheet = c;
    }
  }, 60_000);

  it("skips the image-only pinout PDF", async () => {
    const pinout = (await discoverSources(REPO)).find((s) => s.path.endsWith("pinout.pdf"))!;
    expect(await chunkSource(pinout)).toEqual({ skip: expect.stringContaining("image-only") });
  });

  it("splits the datasheet by its table-of-contents sections, with pages", () => {
    const gpio = datasheet.find((c) => c.content.includes("GPIO 26-28 can be used either as digital GPIO or as ADC inputs"))!;
    expect(gpio.section).toBe("3.2. General purpose I/O");
    expect(gpio.page).toBe(14);
    expect(gpio.content.startsWith("Raspberry Pi Pico 2 W datasheet — 3.2. General purpose I/O\n")).toBe(true);
    const sections = new Set(datasheet.map((c) => c.section));
    for (const s of ["2.1. Pico 2 W pinout", "3.3. Using the ADC", "3.5. Powering Raspberry Pi Pico 2 W", "3.8. Wireless interface"]) expect(sections).toContain(s);
  });

  it("drops the legal page, TOC leaders and figure garbage", () => {
    const all = datasheet.map((c) => c.content).join("\n");
    expect(all).not.toContain("LEGAL DISCLAIMER");
    expect(all).not.toMatch(/\.\s+\.\s+\.\s+\./);
    expect(all).not.toContain("V B U S");
  });

  it("keeps chunks within size limits", () => {
    for (const c of datasheet) expect(c.content.length).toBeLessThanOrEqual(1900);
  });

  it("contains the expected fact for every eval question", () => {
    const cases = readFileSync(`${REPO}data/eval/rag.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { question: string; expect: string[] });
    for (const c of cases) {
      const found = corpus.some((ch) => c.expect.some((e) => ch.content.toLowerCase().includes(e.toLowerCase())));
      expect(found, c.question).toBe(true);
    }
  });
});

describe("chunk helpers", () => {
  it("keeps decimals and section numbers inside sentences", () => {
    expect(splitSentences("Keep it under 3.3 V. See section 2.1. Then go on.")).toEqual(["Keep it under 3.3 V.", "See section 2.1.", "Then go on."]);
  });
  it("chunks generated markdown one bullet per chunk, with its section", () => {
    const chunks = chunkMarkdown("# Title\n\nIntro line.\n\n## Summary\n- Fact one.\n- Fact two.\n## Pins\n- Pin 1.", "Doc");
    expect(chunks.map((c) => [c.section, c.content])).toEqual([
      ["Overview", "Doc — Overview\nIntro line."],
      ["Summary", "Doc — Summary\nFact one."],
      ["Summary", "Doc — Summary\nFact two."],
      ["Pins", "Doc — Pins\nPin 1."],
    ]);
  });
  it("detects spaced-out figure labels", () => {
    expect(isGarbageLine("V B U S V S Y S")).toBe(true);
    expect(isGarbageLine("VBUS is the micro-USB input voltage, connected to micro-USB port pin 1.")).toBe(false);
  });
});

describe("hybrid ranking", () => {
  it("fuses ranks with RRF, rewarding agreement", () => {
    const merged = rrf([
      { name: "vector", ids: [1, 2, 3] },
      { name: "fulltext", ids: [3, 4] },
    ]);
    expect(merged.map((m) => m.id)).toEqual([3, 1, 2, 4]);
    expect(merged[0]!.ranks).toEqual({ vector: 3, fulltext: 1 });
  });
  it("formats citations", () => {
    expect(citationOf({ title: "Pico 2 W datasheet", page: 14, section: "3.2. General purpose I/O" })).toBe("Pico 2 W datasheet, p.14, 3.2. General purpose I/O");
    expect(citationOf({ title: "Pinout (verified data)", page: null, section: "Summary" })).toBe("Pinout (verified data), Summary");
  });
});

describe("embedder", () => {
  const vec = (n: number) => Array.from({ length: 768 }, () => n);
  const fakeFetch = (dims = 768) =>
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { input } = JSON.parse(String(init!.body)) as { input: string[] };
      const data = input.map((_, i) => ({ index: i, embedding: Array.from({ length: dims }, () => i) }));
      return new Response(JSON.stringify({ data: [...data].reverse() }));
    });

  it("adds nomic task prefixes and keeps input order", async () => {
    const f = fakeFetch();
    const e = openAiEmbedder("http://x/v1", "nomic-embed-text", f as unknown as typeof fetch);
    const out = await e.documents(["a", "b"]);
    expect(out).toEqual([vec(0), vec(1)]);
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).input).toEqual(["search_document: a", "search_document: b"]);
    await e.query("q");
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).input).toEqual(["search_query: q"]);
    expect(prefixesFor("bge-m3")).toEqual({ doc: "", query: "" });
  });

  it("batches large inputs", async () => {
    const f = fakeFetch();
    await openAiEmbedder("http://x/v1", "nomic-embed-text", f as unknown as typeof fetch).documents(Array.from({ length: 40 }, (_, i) => `t${i}`));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("rejects vectors with the wrong dimension", async () => {
    await expect(openAiEmbedder("http://x/v1", "m", fakeFetch(384) as unknown as typeof fetch).query("q")).rejects.toThrow(/384-dim/);
  });

  it("formats pgvector literals", () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});

describe("RAG API routes", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });
  const rag: RagService = {
    search: vi.fn(async (query: string) => ({
      mode: "hybrid" as const,
      hits: [
        {
          chunkId: 1,
          content: `match for ${query}`,
          section: "Summary",
          page: null,
          kind: "generated",
          document: { title: "Pinout", path: "data/boards/pico-2-w.pinout.generated.md", board: "pico-2-w" },
          score: 0.03,
          ranks: { vector: 1, fulltext: 1 },
          citation: "Pinout, Summary",
        },
      ],
    })),
    documents: vi.fn(async () => []),
    reindex: vi.fn(async () => ({ indexed: [], unchanged: [], skipped: [], failed: [], removed: [] })),
    chunkCount: vi.fn(async () => 0),
  };
  const make = () =>
    (app = buildApp({
      rag,
      health: { checkDb: async () => ({ status: "ok", detail: "" }), listModels: async () => ["m", "e:latest"], llmModel: "m", embedModel: "e" },
    }));

  it("POST /api/rag/search returns hits with citations", async () => {
    const res = await make().inject({ method: "POST", url: "/api/rag/search", payload: { query: "which pins are ADC?", k: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits[0]).toMatchObject({ citation: "Pinout, Summary", content: "match for which pins are ADC?" });
    expect(rag.search).toHaveBeenCalledWith("which pins are ADC?", { k: 3 });
  });

  it("rejects empty or oversized queries", async () => {
    expect((await make().inject({ method: "POST", url: "/api/rag/search", payload: { query: " " } })).statusCode).toBe(400);
    expect((await make().inject({ method: "POST", url: "/api/rag/search", payload: { query: "x".repeat(501) } })).statusCode).toBe(400);
  });

  it("POST /api/rag/reindex?force=true forces a rebuild", async () => {
    await make().inject({ method: "POST", url: "/api/rag/reindex?force=true" });
    expect(rag.reindex).toHaveBeenCalledWith(true);
  });

  it("GET /api/rag/documents lists documents", async () => {
    expect((await make().inject({ method: "GET", url: "/api/rag/documents" })).json()).toEqual([]);
  });
});

describe("hybridSearch with a fake database", () => {
  const row = (id: number) => ({ id, content: `chunk ${id}`, section: "S", page: 1, kind: "text", title: "Doc", path: "p", board: "pico-2-w" });
  const fakePool = (fts: number[], vec: number[]) => {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      pool: {
        query: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return { rows: (sql === FULLTEXT_SQL ? fts : vec).map(row) };
        },
      } as never,
    };
  };
  const embedder = { query: async () => Array(768).fill(0.1), documents: async () => [] };

  it("runs both retrievers with board filter and merges with RRF", async () => {
    const { pool, calls } = fakePool([3, 4], [1, 2, 3]);
    const res = await hybridSearch(pool, embedder, "which pins are ADC?", { board: "pico-2-w", k: 3 });
    expect(res.mode).toBe("hybrid");
    expect(res.hits.map((h) => h.chunkId)).toEqual([3, 1, 2]);
    expect(calls.map((c) => c.sql)).toEqual([FULLTEXT_SQL, VECTOR_SQL]);
    expect(calls[0]!.params).toEqual(["which pins are ADC?", "pico-2-w", 20]);
    expect(String(calls[1]!.params[0])).toMatch(/^\[0\.1,/);
  });

  it("falls back to full-text when the embedder fails", async () => {
    const { pool } = fakePool([7], []);
    const broken = { ...embedder, query: async () => { throw new Error("connect ECONNREFUSED"); } };
    const res = await hybridSearch(pool, broken, "VSYS range", {});
    expect(res.mode).toBe("fulltext");
    expect(res.warning).toMatch(/ECONNREFUSED/);
    expect(res.hits.map((h) => h.chunkId)).toEqual([7]);
  });

  it("keeps the tsquery inside a CTE (Postgres rejects casts in the FROM list)", () => {
    expect(FULLTEXT_SQL).toMatch(/^WITH query AS \(SELECT replace\(plainto_tsquery/);
    expect(FULLTEXT_SQL).toContain("CROSS JOIN query");
  });
});
