// PGlite (Postgres compiled to WebAssembly, running in this process) behind the same `Db` interface
// as the `pg` pool, so the desktop app needs no database server. pgvector comes as an extension.

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Db, Queryable } from "./db";

/** A new database, or one restored from a data-directory dump (a tar file). */
export function createPglite(dump?: Uint8Array): Promise<PGlite> {
  return PGlite.create({ extensions: { vector }, ...(dump ? { loadDataDir: new Blob([dump]) } : {}) });
}

export function pgliteDb(pg: PGlite): Db {
  const run = (q: PGlite | Transaction): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => {
      const res = await q.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    exec: async (sql) => {
      await q.exec(sql);
    },
  });
  return {
    ...run(pg),
    transaction: (fn) => pg.transaction((tx) => fn(run(tx))),
    close: () => pg.close(),
  };
}
