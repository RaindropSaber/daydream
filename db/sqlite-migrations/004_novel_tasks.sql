CREATE TABLE novel_tasks (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  data TEXT NOT NULL
);
-- Immutable, deduplicated chapter payloads prevent full-book copies on every revision.
CREATE TABLE story_chapter_contents (
  hash TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
