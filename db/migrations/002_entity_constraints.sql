-- Keep version ordering and task ownership consistent even for writes outside the app.
ALTER TABLE asset_versions ADD CONSTRAINT asset_version_number_unique UNIQUE(project_id, asset_id, number);
ALTER TABLE media_versions ADD CONSTRAINT media_version_number_unique UNIQUE(run_id, segment_id, number);
ALTER TABLE jobs ADD CONSTRAINT job_episode_project_fk FOREIGN KEY(episode_id, project_id) REFERENCES episodes(id, project_id);
ALTER TABLE jobs ADD CONSTRAINT job_run_episode_fk FOREIGN KEY(run_id, episode_id) REFERENCES production_runs(id, episode_id);
