ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'));
ALTER TABLE users ADD COLUMN access_status TEXT NOT NULL DEFAULT 'pending' CHECK(access_status IN ('pending','approved','rejected','disabled'));
ALTER TABLE users ADD COLUMN reviewed_at INTEGER;
ALTER TABLE users ADD COLUMN reviewed_by TEXT REFERENCES users(id);
CREATE INDEX users_access_status ON users(access_status,created_at);
CREATE TABLE user_access_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE admin_setup_tokens (
  token_hash TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
