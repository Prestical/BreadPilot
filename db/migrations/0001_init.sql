-- Milestone 0: initial schema.
-- Change existing tables only through new, additive migrations.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- Documentation / RAG ----------
CREATE TABLE documents (
  id          bigserial PRIMARY KEY,
  title       text        NOT NULL,
  board       text        NOT NULL,
  path        text        NOT NULL UNIQUE,
  hash        text        NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  document_id bigint      NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section     text,
  page        int,
  kind        text        NOT NULL CHECK (kind IN ('text', 'table', 'code', 'generated')),
  content     text        NOT NULL,
  tsv         tsvector    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding   vector(768) -- nomic-embed-text dimension
);
CREATE INDEX chunks_document_idx  ON chunks (document_id);
CREATE INDEX chunks_tsv_idx       ON chunks USING gin (tsv);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------- Hardware catalog (loaded from data/*.json at startup) ----------
CREATE TABLE components (
  id        text PRIMARY KEY,
  name      text  NOT NULL,
  category  text  NOT NULL,
  pins      jsonb NOT NULL,
  template  jsonb,
  specs     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------- Projects ----------
CREATE TABLE projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text,
  board      text        NOT NULL DEFAULT 'pico-2-w',
  idea       text        NOT NULL,
  state      text        NOT NULL DEFAULT 'INTAKE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_messages (
  id         bigserial PRIMARY KEY,
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_messages_project_idx ON project_messages (project_id, created_at);

CREATE TABLE plans (
  id          bigserial PRIMARY KEY,
  project_id  uuid  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     int   NOT NULL,
  body        jsonb NOT NULL,
  approved_at timestamptz,
  UNIQUE (project_id, version)
);

CREATE TABLE builds (
  id         bigserial PRIMARY KEY,
  project_id uuid   NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id    bigint REFERENCES plans(id) ON DELETE SET NULL,
  netlist    jsonb,
  layout     jsonb,
  validation jsonb,
  code       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE build_steps (
  id             bigserial PRIMARY KEY,
  build_id       bigint NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  idx            int    NOT NULL,
  kind           text   NOT NULL,
  connection_dsl text,
  title          text   NOT NULL,
  explanation    text,
  citations      jsonb  NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (build_id, idx)
);
