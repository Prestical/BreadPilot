import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// The database the API talks to: PGlite, Postgres compiled to WebAssembly and running inside the
// app (pglite.ts), saved encrypted (snapshot.ts). Only these few calls are used.

export interface DbResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbResult<T>>;
  /** Several statements in one string (a migration file). No parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction on one connection: committed when it returns, rolled back when it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const MIGRATION_LOCK = 727001;

// Applies db/migrations/*.sql in name order, each in its own transaction. A transaction-level
// advisory lock keeps two API instances from applying the same file at the same time.
export async function migrate(db: Db, dir: string, log: (msg: string) => void): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await tx.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  });
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    try {
      const applied = await db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
        const done = await tx.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
        if (done.rows.length) return false;
        await tx.exec(sql);
        await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        return true;
      });
      if (applied) log(`migration applied: ${file}`);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
