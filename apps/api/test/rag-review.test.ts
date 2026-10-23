// Regression tests for the Milestone 3 logic review (one block per finding).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { chunkMarkdown, chunkPages, headingOf } from "../src/rag/chunk";
import type { Embedder } from "../src/rag/embed";
import { cleanPages, footerOffset, groupLines, type PageText } from "../src/rag/extract";
import { discoverSources, ingestAll } from "../src/rag/ingest";
import { FULLTEXT_SQL, hybridSearch } from "../src/rag/search";
import { removeMissing } from "../src/rag/store";

/** In-memory stand-in for the documents/chunks tables, enough for ingest + store. */
class FakeDb {
  docs = new Map<string, { id: number; hash: string; chunks: number }>();
  statements: string[] = [];
  private nextId = 1;
  query = async (sql: string, params: unknown[] = []) => {
    this.statements.push(sql);
    if (sql.startsWith("SELECT hash FROM documents")) {
      const d = this.docs.get(params[0] as string);
      return { rows: d ? [{ hash: d.hash }] : [] };
    }
    if (sql.startsWith("DELETE FROM documents WHERE path = $1")) {
      this.docs.delete(params[0] as string);
      return { rows: [] };
    }
    if (sql.startsWith("DELETE FROM documents WHERE NOT")) {
      const keep = new Set(params[0] as string[]);
      const removed = [...this.docs.keys()].filter((p) => !keep.has(p));
      removed.forEach((p) => this.docs.delete(p));
      return { rows: removed.map((path) => ({ path })) };
    }
    return { rows: [] };
  };
  connect = async () => {
    let path = "";
    let hash = "";
    let chunks = 0;
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith("INSERT INTO documents")) {
          path = params[2] as string;
          hash = params[3] as string;
          return { rows: [{ id: this.docs.get(path)?.id ?? this.nextId++ }] };
        }
        if (sql.startsWith("INSERT INTO chunks")) chunks++;
        if (sql === "COMMIT") this.docs.set(path, { id: this.docs.get(path)?.id ?? this.nextId, hash, chunks });
        return { rows: [] };
      },
      release: () => {},
    };
  };
  get pool() {
    return this as never;
  }
}

const embedder = (fail?: (text: string) => boolean, delay = 0): Embedder => ({
  documents: async (texts) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail && texts.some(fail)) throw new Error("embedding model crashed");
    return texts.map(() => Array(768).fill(0));
  },
  query: async () => Array(768).fill(0),
});

// Temporary repos made by the tests are removed at the end (they used to pile up in the temp folder).
const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "breadpilot-rag-"));
  tempDirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

describe("#1 an empty or missing docs folder never wipes the index", () => {
  it("leaves existing documents alone", async () => {
    const db = new FakeDb();
    db.docs.set("docs/hardware/pico-2-w/pico-2-w-datasheet.pdf", { id: 1, hash: "x", chunks: 39 });
    const report = await ingestAll({ pool: db.pool, embedder: embedder(), repoDir: await repoWith({}), embedModel: "m" });
    expect(report.removed).toEqual([]);
    expect(db.docs.size).toBe(1);
    expect(db.statements.some((s) => s.startsWith("DELETE"))).toBe(false);
  });
  it("removeMissing refuses an empty keep-list", async () => {
    await expect(removeMissing(new FakeDb().pool, [])).rejects.toThrow(/refusing/);
  });
});

describe("#2 a forced reindex during a running one is queued, not ignored", () => {
  it("runs again with force after the current run", async () => {
    const db = new FakeDb();
    const repoDir = await repoWith({ "data/boards/pico-2-w.pinout.generated.md": "## Pins\n- Pin 1." });
    const first = ingestAll({ pool: db.pool, embedder: embedder(undefined, 30), repoDir, embedModel: "m" });
    const forced = ingestAll({ pool: db.pool, embedder: embedder(), repoDir, embedModel: "m", force: true });
    expect(forced).not.toBe(first);
    expect((await first).indexed).toHaveLength(1);
    // Same file, unchanged hash: only a forced run indexes it again.
    expect((await forced).indexed).toHaveLength(1);
    expect((await ingestAll({ pool: db.pool, embedder: embedder(), repoDir, embedModel: "m" })).unchanged).toHaveLength(1);
  });
});

describe("#4 one failing document doesn't stop the others", () => {
  it("reports the failure and indexes the rest", async () => {
    const db = new FakeDb();
    const repoDir = await repoWith({
      "data/boards/aaa.pinout.generated.md": "## Pins\n- BROKEN",
      "data/boards/pico-2-w.pinout.generated.md": "## Pins\n- Pin 1.",
    });
    const report = await ingestAll({ pool: db.pool, embedder: embedder((t) => t.includes("BROKEN")), repoDir, embedModel: "m" });
    expect(report.failed).toEqual([{ path: "data/boards/aaa.pinout.generated.md", error: "embedding model crashed" }]);
    expect(report.indexed.map((i) => i.path)).toEqual(["data/boards/pico-2-w.pinout.generated.md"]);
  });
});

describe("#6 board variants map to the canonical board", () => {
  it("indexes a pico-2-wh folder as pico-2-w", async () => {
    const sources = await discoverSources(await repoWith({ "docs/hardware/pico-2-wh/pico-2-wh-notes.pdf": "%PDF" }));
    expect(sources[0]!.board).toBe("pico-2-w");
  });
  it("searches pico-2-wh documents under pico-2-w", async () => {
    const params: unknown[][] = [];
    const pool = { query: async (_: string, p: unknown[]) => (params.push(p), { rows: [] }) } as never;
    await hybridSearch(pool, null, "adc pins", { board: "pico-2-wh" });
    expect(params[0]).toEqual(["adc pins", "pico-2-w", 20]);
  });
});

describe("#7 only real running footers are removed", () => {
  const pages = (lastLines: string[]): PageText[] => lastLines.map((last, i) => ({ page: i + 1, lines: [`Body text of page ${i + 1} about pins.`, last] }));

  it("finds the printed-page offset and removes matching footers", () => {
    const p = pages(["Title", "Colophon 1", "About Pico 2 2", "About Pico 2 3", "Powerchain 4"]);
    expect(footerOffset(p)).toBe(1);
    expect(cleanPages(p).flatMap((x) => x.lines)).not.toContain("About Pico 2 3");
  });
  it("keeps body lines that merely end in a number", () => {
    const p = pages(["Keep the load under 300", "Connect it to pin 36", "VSYS accepts up to 5", "The ADC has 12"]);
    expect(footerOffset(p)).toBeNull();
    expect(cleanPages(p).flatMap((x) => x.lines)).toContain("Connect it to pin 36");
  });
});

describe("#8 subscripts stay on their line", () => {
  it("joins items within 3 units of the baseline, left to right", () => {
    const lines = groupLines([
      { x: 10, y: 700, str: "the threshold voltage V" },
      { x: 120, y: 698, str: "t" },
      { x: 130, y: 700, str: "of the P-FET" },
      { x: 10, y: 688, str: "next line" },
    ]);
    expect(lines).toEqual(["the threshold voltage V t of the P-FET", "next line"]);
  });
});

describe("#9 citations point at the first new sentence's page", () => {
  it("does not cite the page of the overlap sentence", () => {
    const long = (n: number) => `Sentence ${n} ${"x".repeat(380)}.`;
    const pages: PageText[] = [
      { page: 1, lines: ["1. Intro", long(1), long(2), "Short tail sentence one."] },
      { page: 2, lines: [long(3), long(4), long(5)] },
    ];
    const chunks = chunkPages(pages, [{ number: "1.", title: "Intro" }], "Doc");
    expect(chunks.length).toBeGreaterThan(1);
    const second = chunks[1]!;
    expect(second.content).toContain("Short tail sentence one."); // overlap from page 1
    expect(second.page).toBe(2);
  });
});

describe("#10 markdown text outside bullets is kept", () => {
  it("joins continuation lines and keeps paragraphs", () => {
    const chunks = chunkMarkdown("## Notes\n- First bullet\n  continues here.\n\nA paragraph line.\n- Second bullet.", "Doc");
    expect(chunks.map((c) => c.content)).toEqual([
      "Doc — Notes\nFirst bullet continues here.",
      "Doc — Notes\nA paragraph line.",
      "Doc — Notes\nSecond bullet.",
    ]);
  });
  it("labels bullets before any section as Overview", () => {
    expect(chunkMarkdown("- Lone bullet.", "Doc")[0]!.section).toBe("Overview");
  });
});

describe("#11 headings: exact match wins, list items aren't headings", () => {
  const toc = [
    { number: "2.", title: "Mechanical specification" },
    { number: "2.1.", title: "Pico 2 W pinout" },
    { number: "C.", title: "Mean Time Between Failure (MTBF)" },
  ];
  it("matches exact and wrapped headings", () => {
    expect(headingOf("2.1. Pico 2 W pinout", toc)).toBe("2.1. Pico 2 W pinout");
    expect(headingOf("C. Mean Time Between Failure", toc)).toBe("C. Mean Time Between Failure (MTBF)");
  });
  it("ignores numbered list items and bare numbers", () => {
    expect(headingOf("2. Some PSU noise will not be filtered", toc)).toBeNull();
    expect(headingOf("2.", toc)).toBeNull();
  });
});

describe("#12 vector hits carry a cosine similarity", () => {
  it("reports 1 - distance for vector hits only", async () => {
    const row = (id: number, distance?: number) => ({ id, content: "c", section: null, page: null, kind: "text", title: "T", path: "p", board: "b", ...(distance !== undefined ? { distance } : {}) });
    const pool = { query: async (sql: string) => ({ rows: sql === FULLTEXT_SQL ? [row(2)] : [row(1, 0.25)] }) } as never;
    const res = await hybridSearch(pool, embedder(), "q", {});
    expect(res.hits.find((h) => h.chunkId === 1)!.similarity).toBe(0.75);
    expect(res.hits.find((h) => h.chunkId === 2)!.similarity).toBeUndefined();
  });
});
