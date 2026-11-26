CREATE TABLE IF NOT EXISTS game_metadata (
  game_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  steam_id INTEGER,
  classification TEXT NOT NULL DEFAULT 'unknown' CHECK(classification IN ('online','hybrid','offline','unknown')),
  source TEXT NOT NULL DEFAULT 'unknown',
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_game_metadata_classification ON game_metadata(classification);
