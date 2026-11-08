CREATE TABLE workspace_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  account_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (account_id) REFERENCES workspace_account(id)
);
CREATE TABLE auth_attempts (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  retry_at INTEGER NOT NULL
);
