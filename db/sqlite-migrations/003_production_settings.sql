CREATE TABLE production_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  style TEXT NOT NULL,
  ratio TEXT NOT NULL,
  prompt TEXT NOT NULL,
  adaptation TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO production_settings(project_id,style,ratio,prompt,adaptation,revision)
SELECT id,style,ratio,
  trim(coalesce(json_extract(metadata,'$.creative_prompt'),'') || char(10) ||
    coalesce((SELECT group_concat(key || '：' || value,char(10)) FROM json_each(json_extract(projects.metadata,'$.creative_spec')) WHERE value != ''),'')),
  '',coalesce(json_extract(metadata,'$.config_revision'),0)
FROM projects;
UPDATE projects SET metadata=json_remove(metadata,'$.creative_prompt','$.creative_spec','$.config_revision');
ALTER TABLE projects DROP COLUMN style;
ALTER TABLE projects DROP COLUMN ratio;
