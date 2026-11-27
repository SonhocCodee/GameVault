-- User-submitted bug reports with optional diagnostic log attachment
CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  severity TEXT NOT NULL DEFAULT 'medium',
  description TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  gpu_summary TEXT NOT NULL DEFAULT '',
  log_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  fixed_in_version TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_uid_created ON bug_reports(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status_created ON bug_reports(status, created_at DESC);
