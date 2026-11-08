CREATE TABLE admin_provision_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_role TEXT,
  previous_status TEXT,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'server_cli' CHECK(source='server_cli')
);
