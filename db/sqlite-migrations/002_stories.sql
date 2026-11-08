CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
  title TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE story_revisions (
  story_id TEXT NOT NULL REFERENCES stories(id),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (story_id, revision)
);
