-- Keep score changes so historical months never use a later rating.
CREATE TABLE IF NOT EXISTS community_rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  game_key TEXT NOT NULL,
  game_title TEXT NOT NULL,
  cover_url TEXT,
  score REAL CHECK(score IS NULL OR (score >= 1 AND score <= 10)),
  effective_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rating_history_game_user_time
  ON community_rating_history(uid, game_key, effective_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rating_history_time ON community_rating_history(effective_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_month ON user_sessions(start_time, uid, game_key);

-- Only the latest known pre-migration score can be recovered honestly.
INSERT INTO community_rating_history(uid, game_key, game_title, cover_url, score, effective_at)
SELECT r.uid, r.game_key, r.game_title, r.cover_url, r.score, r.updated_at
FROM ratings r
WHERE NOT EXISTS (
  SELECT 1 FROM community_rating_history h WHERE h.uid=r.uid AND h.game_key=r.game_key
);

CREATE TRIGGER IF NOT EXISTS monthly_rating_insert AFTER INSERT ON ratings BEGIN
  INSERT INTO community_rating_history(uid, game_key, game_title, cover_url, score, effective_at)
  VALUES (NEW.uid, NEW.game_key, NEW.game_title, NEW.cover_url, NEW.score, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS monthly_rating_update AFTER UPDATE ON ratings
WHEN NEW.score IS NOT OLD.score OR NEW.review IS NOT OLD.review OR NEW.dropped IS NOT OLD.dropped
BEGIN
  INSERT INTO community_rating_history(uid, game_key, game_title, cover_url, score, effective_at)
  VALUES (NEW.uid, NEW.game_key, NEW.game_title, NEW.cover_url, NEW.score, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS monthly_rating_delete AFTER DELETE ON ratings BEGIN
  INSERT INTO community_rating_history(uid, game_key, game_title, cover_url, score, effective_at)
  VALUES (OLD.uid, OLD.game_key, OLD.game_title, OLD.cover_url, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
