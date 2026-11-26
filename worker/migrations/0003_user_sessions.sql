CREATE TABLE IF NOT EXISTS user_sessions (
  uid TEXT NOT NULL,
  game_key TEXT NOT NULL,
  source TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, game_key, source, start_time)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_uid ON user_sessions(uid);
