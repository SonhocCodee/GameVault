-- Client diagnostic logs uploaded from desktop app for remote troubleshooting
CREATE TABLE IF NOT EXISTS client_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  gpu_summary TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  log_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_logs_uid_created ON client_logs(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_logs_created ON client_logs(created_at DESC);
