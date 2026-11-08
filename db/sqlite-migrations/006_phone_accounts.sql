CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);
ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX projects_user ON projects(user_id);
CREATE TABLE media_owners (
  filename TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
);
