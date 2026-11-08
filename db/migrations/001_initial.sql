CREATE TABLE IF NOT EXISTS projects (
 id text PRIMARY KEY, title text NOT NULL, brief text NOT NULL DEFAULT '', style text NOT NULL, ratio text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL, updated_at double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), title text NOT NULL, brief text NOT NULL DEFAULT '',
 number integer NOT NULL, active_run text, metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL,
 UNIQUE(id, project_id), UNIQUE(project_id,number)
);
CREATE TABLE IF NOT EXISTS production_runs (
 id text PRIMARY KEY, episode_id text NOT NULL, project_id text NOT NULL REFERENCES projects(id), name text NOT NULL, model text NOT NULL,
 planning_schema integer NOT NULL DEFAULT 2, metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL,
 FOREIGN KEY(episode_id,project_id) REFERENCES episodes(id,project_id), UNIQUE(id,episode_id)
);
ALTER TABLE episodes ADD CONSTRAINT active_run_fk FOREIGN KEY(active_run,id) REFERENCES production_runs(id,episode_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS content_versions (
 run_id text NOT NULL REFERENCES production_runs(id), step text NOT NULL, id text NOT NULL, number integer NOT NULL,
 content jsonb NOT NULL, inputs jsonb NOT NULL, approved boolean NOT NULL DEFAULT false, source text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL, PRIMARY KEY(run_id,step,id), UNIQUE(run_id,step,number)
);
CREATE TABLE IF NOT EXISTS selected_versions (
 run_id text NOT NULL REFERENCES production_runs(id), step text NOT NULL, version_id text NOT NULL,
 PRIMARY KEY(run_id,step), FOREIGN KEY(run_id,step,version_id) REFERENCES content_versions(run_id,step,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS assets (
 project_id text NOT NULL REFERENCES projects(id), id text NOT NULL, name text NOT NULL, kind text NOT NULL,
 selected_version text, metadata jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(project_id,id)
);
CREATE TABLE IF NOT EXISTS asset_versions (
 project_id text NOT NULL, asset_id text NOT NULL, id text NOT NULL, number integer NOT NULL,
 content jsonb NOT NULL, created_at double precision NOT NULL, PRIMARY KEY(project_id,asset_id,id),
 FOREIGN KEY(project_id,asset_id) REFERENCES assets(project_id,id)
);
ALTER TABLE assets ADD CONSTRAINT selected_asset_fk FOREIGN KEY(project_id,id,selected_version) REFERENCES asset_versions(project_id,asset_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS conversation_messages (
 run_id text NOT NULL REFERENCES production_runs(id), step text NOT NULL, id text NOT NULL, position integer NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), text text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL,
 PRIMARY KEY(run_id,step,id)
);
CREATE TABLE IF NOT EXISTS media_versions (
 run_id text NOT NULL REFERENCES production_runs(id), segment_id text NOT NULL, id text NOT NULL, number integer NOT NULL,
 content jsonb NOT NULL, input_hash text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL,
 PRIMARY KEY(run_id,segment_id,id)
);
CREATE TABLE IF NOT EXISTS media_selections (
 run_id text NOT NULL REFERENCES production_runs(id), segment_id text NOT NULL, version_id text NOT NULL,
 PRIMARY KEY(run_id,segment_id), FOREIGN KEY(run_id,segment_id,version_id) REFERENCES media_versions(run_id,segment_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS exports (
 run_id text NOT NULL REFERENCES production_runs(id), id text NOT NULL, content jsonb NOT NULL, inputs jsonb NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL, PRIMARY KEY(run_id,id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), episode_id text NOT NULL REFERENCES episodes(id),
 run_id text NOT NULL REFERENCES production_runs(id), kind text NOT NULL, state text NOT NULL CHECK(state IN ('queued','running','done','failed')),
 message text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at double precision NOT NULL, updated_at double precision NOT NULL,
 owner text, heartbeat_at timestamptz, attempt integer NOT NULL DEFAULT 0
);
CREATE INDEX jobs_queue_idx ON jobs(state,created_at);
CREATE INDEX jobs_project_idx ON jobs(project_id,created_at DESC);
CREATE INDEX jobs_run_idx ON jobs(run_id,state);
CREATE INDEX episodes_project_idx ON episodes(project_id);
CREATE INDEX versions_run_idx ON content_versions(run_id,step,number);
CREATE TABLE IF NOT EXISTS settings (id text PRIMARY KEY, encrypted text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS legacy_imports (source_hash text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL);
