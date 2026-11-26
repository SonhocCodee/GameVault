CREATE TABLE IF NOT EXISTS community_profiles (
 uid TEXT PRIMARY KEY, nickname TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
 share_library INTEGER NOT NULL DEFAULT 0, suspended INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS community_library (
 uid TEXT NOT NULL, game_key TEXT NOT NULL, title TEXT NOT NULL, steam_id INTEGER,
 cover_url TEXT, status TEXT NOT NULL, playtime_minutes INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(uid, game_key)
);
CREATE INDEX IF NOT EXISTS idx_community_library_game ON community_library(game_key);
CREATE TABLE IF NOT EXISTS community_posts (
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, game_key TEXT NOT NULL, game_title TEXT NOT NULL,
 steam_id INTEGER, cover_url TEXT, kind TEXT NOT NULL, body TEXT NOT NULL,
 spoiler INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON community_posts(hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_game ON community_posts(game_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_review_post ON community_posts(uid,game_key) WHERE kind='review';
CREATE TABLE IF NOT EXISTS community_images (
 key TEXT PRIMARY KEY, uid TEXT NOT NULL, post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
 mime TEXT NOT NULL, data BLOB, size INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_images_post ON community_images(post_id);
CREATE TABLE IF NOT EXISTS community_likes (
 uid TEXT NOT NULL, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, PRIMARY KEY(uid,post_id)
);
CREATE TABLE IF NOT EXISTS community_saved (
 uid TEXT NOT NULL, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, PRIMARY KEY(uid,post_id)
);
CREATE TABLE IF NOT EXISTS community_comments (
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
 body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id,created_at);
CREATE TABLE IF NOT EXISTS community_review_meta (
 uid TEXT NOT NULL, game_key TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
 hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(uid,game_key)
);
CREATE TABLE IF NOT EXISTS community_blocks (
 uid TEXT NOT NULL, blocked_uid TEXT NOT NULL, PRIMARY KEY(uid,blocked_uid)
);
CREATE TABLE IF NOT EXISTS community_notifications (
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, actor_uid TEXT NOT NULL, post_id TEXT NOT NULL,
 kind TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(uid,actor_uid,post_id,kind)
);
CREATE INDEX IF NOT EXISTS idx_community_notifications_user ON community_notifications(uid,created_at DESC);
CREATE TABLE IF NOT EXISTS community_reports (
 id TEXT PRIMARY KEY, reporter_uid TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(reporter_uid,target_type,target_id)
);
CREATE TABLE IF NOT EXISTS community_performance (
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, game_key TEXT NOT NULL, game_title TEXT NOT NULL,
 data_json TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(uid,game_key)
);
CREATE INDEX IF NOT EXISTS idx_community_performance_game ON community_performance(game_key);
CREATE TABLE IF NOT EXISTS community_rate_limits (
 actor TEXT NOT NULL, action TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(actor,action,window)
);
CREATE TABLE IF NOT EXISTS community_steam_cache (
 key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL
);
