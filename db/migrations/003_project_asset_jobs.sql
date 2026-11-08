-- Shared resource generation belongs to a project and requires no production run.
ALTER TABLE jobs ALTER COLUMN episode_id DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT job_scope_check CHECK (
  (kind = 'asset-image' AND episode_id IS NULL AND run_id IS NULL)
  OR (kind <> 'asset-image' AND episode_id IS NOT NULL AND run_id IS NOT NULL)
);
