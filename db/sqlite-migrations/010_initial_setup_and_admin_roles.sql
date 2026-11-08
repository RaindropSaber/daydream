CREATE TABLE initial_admin_setup (
  id INTEGER PRIMARY KEY CHECK(id=1),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE admin_role_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_role TEXT,
  previous_status TEXT,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'server_cli' CHECK(source IN ('server_cli','initial_setup','admin_dashboard')),
  actor_id TEXT REFERENCES users(id)
);
INSERT INTO admin_role_events(id,user_id,previous_role,previous_status,created_at,source)
  SELECT id,user_id,previous_role,previous_status,created_at,source FROM admin_provision_events;
DROP TABLE admin_provision_events;
