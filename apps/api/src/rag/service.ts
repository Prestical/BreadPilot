import type pg from "pg";
import type { Embedder } from "./embed";
import { ingestAll, type IngestReport } from "./ingest";
import { hybridSearch, type SearchResult } from "./search";
import { chunkCount, listDocuments, type DocumentRow } from "./store";

/** What the API routes need from RAG (swappable in tests). */
export interface RagService {
  search(query: string, opts: { board?: string; k?: number }): Promise<SearchResult>;
  documents(): Promise<DocumentRow[]>;
  reindex(force: boolean): Promise<IngestReport>;
  chunkCount(): Promise<number>;
}

export function createRagService(deps: { pool: pg.Pool; embedder: Embedder; repoDir: string; embedModel: string; log: (msg: string) => void }): RagService {
  return {
    search: (query, opts) => hybridSearch(deps.pool, deps.embedder, query, opts),
    documents: () => listDocuments(deps.pool),
    reindex: (force) => ingestAll({ ...deps, force }),
    chunkCount: () => chunkCount(deps.pool),
  };
}
