-- Milestone 4: a project is stored as one JSON document (projects.data) holding the
-- intake, plan versions, build, steps, code and stage events. For a single-user local
-- app this is simpler than the normalized plans/builds/build_steps tables from 0001,
-- which were never used and are dropped here (they are empty).

ALTER TABLE projects ADD COLUMN data jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX projects_updated_idx ON projects (updated_at DESC);

DROP TABLE build_steps;
DROP TABLE builds;
DROP TABLE plans;
