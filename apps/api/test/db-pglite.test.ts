// The API's real database code on PGlite (the desktop app's database): migrations, project store,
// RAG store and hybrid search, health check. Runs without Docker or a Postgres server.
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "../src/agent/project";
import { dbStore } from "../src/agent/project";
import { migrate, type Db } from "../src/db";
import { dbCheck } from "../src/health";
import { createPglite, pgliteDb } from "../src/pglite";
import { EMBED_DIM, type Embedder } from "../src/rag/embed";
import { ingestAll } from "../src/rag/ingest";
import { hybridSearch } from "../src/rag/search";
import { chunkCount, documentHash, listDocuments, removeMissing, replaceDocument } from "../src/rag/store";

const MIGRATIONS = resolve(import.meta.dirname, "../../../db/migrations");
const SLOW = 30_000;

/** Deterministic stand-in for nomic-embed-text: hashed words, normalised. Shared words → similar vectors. */
function vec(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % EMBED_DIM]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const embedder: Embedder = { documents: async (t) => t.map(vec), query: async (t) => vec(t) };

let db: Db;
const logs: string[] = [];
beforeAll(async () => {
  db = pgliteDb(await createPglite());
  await migrate(db, MIGRATIONS, (m) => logs.push(m));
}, SLOW);
afterAll(async () => {
  await db?.close();
});

describe("migrations on PGlite", () => {
  it("applies the real migration files unchanged, once", async () => {
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql"));
    expect(logs).toEqual(files.sort().map((f) => `migration applied: ${f}`));
    const again: string[] = [];
    await migrate(db, MIGRATIONS, (m) => again.push(m));
    expect(again).toEqual([]);
  });

  it("rolls a failing migration back completely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "breadpilot-mig-"));
    try {
      for (const f of await readdir(MIGRATIONS)) await copyFile(join(MIGRATIONS, f), join(dir, f));
      await writeFile(join(dir, "9999_broken.sql"), "CREATE TABLE half_done (x int);\nSELECT no_such_function();");
      await expect(migrate(db, dir, () => {})).rejects.toThrow(/migration 9999_broken.sql failed/);
      const table = await db.query("SELECT to_regclass('half_done') AS t");
      expect(table.rows[0]).toEqual({ t: null });
      const row = await db.query("SELECT 1 FROM schema_migrations WHERE name = '9999_broken.sql'");
      expect(row.rows).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Db.transaction on PGlite", () => {
  it("commits on return and rolls back on throw", async () => {
    await db.exec("CREATE TEMP TABLE tx_test (n int)");
    await db.transaction((tx) => tx.query("INSERT INTO tx_test VALUES (1)"));
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO tx_test VALUES (2)");
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect((await db.query<{ n: number }>("SELECT n FROM tx_test")).rows).toEqual([{ n: 1 }]);
  });
});

describe("health check on PGlite", () => {
  it("finds pgvector", async () => {
    const res = await dbCheck(db)();
    expect(res.status).toBe("ok");
    expect(res.detail).toMatch(/pgvector \d/);
  });
});

describe("project store on PGlite", () => {
  const project = (id: string, updatedAt: string) =>
    ({ id, title: "Blink", board: "pico-2-w", idea: "blink an LED", state: "READY", updatedAt, events: [] }) as unknown as Project;

  it("creates, saves, lists, reads and deletes", async () => {
    const store = dbStore(db);
    const a = project("6f1c1a52-1f2b-4c43-9a43-2d4f3b4d9e10", "2026-10-26T10:00:00.000Z");
    const b = project("0b9e6c1e-7a1d-4d3e-8b8e-1c2d3e4f5a6b", "2026-10-26T11:00:00.000Z");
    await store.create(a);
    await store.create(b);
    await store.save({ ...a, title: "Blink fast" });
    expect((await store.get(a.id))?.title).toBe("Blink fast");
    expect((await store.list()).map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await store.list())[0]!.updatedAt).toBe(b.updatedAt);
    expect(await store.delete(a.id)).toBe(true);
    expect(await store.delete(a.id)).toBe(false);
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get("not-a-uuid")).toBeNull();
  });
});

describe("RAG store and hybrid search on PGlite", () => {
  const chunk = (content: string, page: number) => ({ section: "Pins", page, kind: "text" as const, content, embedding: vec(content) });

  it("stores documents and finds chunks by words and by vectors", async () => {
    const texts = ["GP26, GP27 and GP28 are the ADC input pins.", "VSYS is the main system power input, 1.8 to 5.5 V.", "The on-board LED is driven by the wireless chip."];
    await replaceDocument(db, { title: "Datasheet", board: "pico-2-w", path: "docs/a.pdf", hash: "h1" }, texts.map((t, i) => chunk(t, i + 1)));
    await replaceDocument(db, { title: "Other board", board: "other", path: "docs/b.pdf", hash: "h2" }, [chunk("ADC pins on another board", 1)]);
    expect(await chunkCount(db)).toBe(4);
    expect(await documentHash(db, "docs/a.pdf")).toBe("h1");

    const res = await hybridSearch(db, embedder, "Which pins are ADC inputs?", { board: "pico-2-w", k: 2 });
    expect(res.mode).toBe("hybrid");
    expect(res.hits[0]!.content).toContain("ADC input pins");
    expect(res.hits[0]!.ranks.vector).toBe(1);
    expect(res.hits[0]!.ranks.fulltext).toBe(1);
    expect(res.hits.every((h) => h.document.board === "pico-2-w")).toBe(true);
    expect(res.hits[0]!.citation).toBe("Datasheet, p.1, Pins");
  });

  it("replaces a document's chunks in one go and removes missing files", async () => {
    await replaceDocument(db, { title: "Datasheet", board: "pico-2-w", path: "docs/a.pdf", hash: "h3" }, [chunk("Only one chunk now.", 1)]);
    const docs = await listDocuments(db);
    expect(docs.find((d) => d.path === "docs/a.pdf")).toMatchObject({ hash: "h3", chunks: 1 });
    expect(await removeMissing(db, ["docs/a.pdf"])).toEqual(["docs/b.pdf"]);
    expect(await chunkCount(db)).toBe(1);
  });

  it("without the embedding model, stores the text for keyword search and adds the vectors later", async () => {
    // Its own database: ingesting this folder drops documents that aren't in it.
    const own = pgliteDb(await createPglite());
    await migrate(own, MIGRATIONS, () => {});
    const repo = await mkdtemp(join(tmpdir(), "breadpilot-docs-"));
    try {
      await mkdir(join(repo, "data", "boards"), { recursive: true });
      await writeFile(join(repo, "data", "boards", "pico-2-w.pinout.generated.md"), "## ADC pins\n- GP26, GP27 and GP28 can read analog voltages (ADC).\n");
      const noModel: Embedder = {
        documents: async () => {
          throw new Error("model 'nomic-embed-text' not found");
        },
        query: async () => {
          throw new Error("model 'nomic-embed-text' not found");
        },
      };
      const first = await ingestAll({ db: own, embedder: noModel, repoDir: repo, embedModel: "nomic-embed-text" });
      expect(first.textOnly.map((t) => t.path)).toEqual(["data/boards/pico-2-w.pinout.generated.md"]);
      const kw = await hybridSearch(own, noModel, "analog ADC pins", { board: "pico-2-w" });
      expect(kw.mode).toBe("fulltext");
      expect(kw.hits.some((h) => h.content.includes("GP26"))).toBe(true);

      // The model is there now: the same file is embedded on the next run (its hash was marked).
      const second = await ingestAll({ db: own, embedder, repoDir: repo, embedModel: "nomic-embed-text" });
      expect(second.indexed.map((d) => d.path)).toEqual(["data/boards/pico-2-w.pinout.generated.md"]);
      const both = await hybridSearch(own, embedder, "analog ADC pins", { board: "pico-2-w" });
      expect(both.mode).toBe("hybrid");
      const third = await ingestAll({ db: own, embedder, repoDir: repo, embedModel: "nomic-embed-text" });
      expect(third.unchanged).toEqual(["data/boards/pico-2-w.pinout.generated.md"]);
    } finally {
      await own.close();
      await rm(repo, { recursive: true, force: true });
    }
  }, SLOW);

  it("keeps the old chunks when a replacement fails halfway", async () => {
    const bad = [chunk("fine", 1), { ...chunk("broken", 2), embedding: [1, 2, 3] }]; // wrong vector size
    await expect(replaceDocument(db, { title: "Datasheet", board: "pico-2-w", path: "docs/a.pdf", hash: "h4" }, bad)).rejects.toThrow();
    expect(await documentHash(db, "docs/a.pdf")).toBe("h3");
    expect(await chunkCount(db)).toBe(1);
  });
});

describe("project changes on a real database (M9, the user's report 11/11/2026)", () => {
  it("adding an LED to a stored display + knob project only adds the LED (JSONB reorders object keys)", async () => {
    const { changeSteps, layoutProject, stableRequests } = await import("@breadpilot/circuit-core");
    const store = dbStore(db);
    const before = layoutProject([{ kind: "oled" }, { kind: "pot" }]);
    const p = {
      id: "22222222-2222-4222-8222-222222222222",
      idea: "display and knob",
      board: "pico-2-w",
      title: "t",
      state: "READY",
      plans: [],
      events: [],
      build: { build: before.build, blocks: before.blocks, steps: [], codeAttempts: 1, citations: [] },
      createdAt: "2026-11-11T10:00:00.000Z",
      updatedAt: "2026-11-11T10:00:00.000Z",
    } as unknown as Project;
    await store.create(p);
    const stored = (await store.get(p.id))!.build!;
    const old = { build: stored.build, blocks: stored.blocks };
    const after = layoutProject(stableRequests(old, [{ kind: "oled" }, { kind: "pot" }, { kind: "led" }]), undefined, { reservedRefs: old.build.parts.map((x) => x.ref) });
    const steps = changeSteps(old.build, after.build);
    expect(steps.map((s) => s.kind + (s.partRef ? `:${s.partRef}` : ""))).toEqual(["unplug", "place-part:R1", "place-part:LED1", "wire", "wire", "usb"]);
  });
});

describe("power switch on a real database (found with the M9 bug, 11/11/2026)", () => {
  it("a stored project can switch rails → direct (its stored blocks compare equal despite JSONB key order)", async () => {
    const { layoutProject } = await import("@breadpilot/circuit-core");
    const { setPower, planToRequests } = await import("../src/agent/pipeline");
    const plan = { title: "t", goal: "g", behavior: ["b"], parts: [{ kind: "led", purpose: "light", color: "red" }, { kind: "button", purpose: "switch" }], questions: [], version: 1, approved: true };
    const l = layoutProject(planToRequests(plan as never));
    const store = dbStore(db);
    const p = {
      id: "33333333-3333-4333-8333-333333333333",
      idea: "led and button",
      board: "pico-2-w",
      title: "t",
      state: "READY",
      plans: [plan],
      events: [],
      build: { build: l.build, blocks: l.blocks, steps: [], codeAttempts: 1, citations: [] },
      createdAt: "2026-11-11T10:00:00.000Z",
      updatedAt: "2026-11-11T10:00:00.000Z",
    } as unknown as Project;
    await store.create(p);
    const llm = { model: "fake", json: async () => { throw new Error("no LLM in a power switch"); } };
    const switched = await setPower({ llm, store } as never, p.id, "direct");
    expect(switched.power).toBe("direct");
  });
});
