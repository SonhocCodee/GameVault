CREATE TABLE IF NOT EXISTS user_sync_state (
  uid TEXT PRIMARY KEY NOT NULL,
  sync_epoch INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
