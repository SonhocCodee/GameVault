-- GameVault Cloudflare D1 Database Schema

-- 1. Users Table (Profile & Hardware)
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    photo_url TEXT,
    gpu TEXT NOT NULL DEFAULT '',
    cpu TEXT NOT NULL DEFAULT '',
    ram_gb INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Ratings Table (Game Reviews & Metrics)
CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY NOT NULL,
    uid TEXT NOT NULL,
    game_key TEXT NOT NULL,
    game_title TEXT NOT NULL,
    cover_url TEXT,
    score REAL NOT NULL CHECK(score >= 1 AND score <= 10),
    review TEXT NOT NULL DEFAULT '',
    dropped INTEGER NOT NULL DEFAULT 0 CHECK(dropped IN (0, 1)),
    drop_reason TEXT,
    playtime_minutes INTEGER NOT NULL DEFAULT 0,
    fps INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT unq_ratings_uid_game UNIQUE(uid, game_key)
);

-- 3. Community Picks Table (Monthly State)
CREATE TABLE IF NOT EXISTS community_follows (
    uid TEXT NOT NULL,
    followed_uid TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (uid, followed_uid),
    CHECK (uid <> followed_uid)
);
CREATE INDEX IF NOT EXISTS idx_community_followers ON community_follows(followed_uid, uid);

CREATE TABLE IF NOT EXISTS community_picks (
    month TEXT PRIMARY KEY NOT NULL, -- Format: YYYY-MM
    state TEXT NOT NULL DEFAULT 'voting' CHECK(state IN ('voting', 'playing', 'done')),
    game_key TEXT,
    game_title TEXT,
    cover_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Community Votes Table (Per-User Votes per Month)
CREATE TABLE IF NOT EXISTS community_votes (
    id TEXT PRIMARY KEY NOT NULL,
    month TEXT NOT NULL,
    uid TEXT NOT NULL,
    game_key TEXT NOT NULL,
    game_title TEXT NOT NULL,
    cover_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT unq_votes_month_uid UNIQUE(month, uid)
);

-- 5. User Library Table (Multi-Device Library Sync)
CREATE TABLE IF NOT EXISTS user_library (
    uid TEXT NOT NULL,
    game_key TEXT NOT NULL,
    title TEXT NOT NULL,
    steam_id INTEGER,
    cover_url TEXT,
    banner_url TEXT,
    status TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('playing', 'completed', 'paused', 'dropped', 'backlog')),
    playtime_minutes INTEGER NOT NULL DEFAULT 0,
    recorded_playtime_minutes INTEGER NOT NULL DEFAULT 0,
    last_played TEXT,
    completed_at TEXT,
    user_score REAL,
    user_notes TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    client_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (uid, game_key)
);

-- 6. Central Game Covers Catalog (Single source of truth for all users)
CREATE TABLE IF NOT EXISTS game_covers (
    game_key TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    steam_id INTEGER,
    cover_url TEXT,
    banner_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. Image Store (D1 fallback when R2 IMAGES_BUCKET is not bound)
CREATE TABLE IF NOT EXISTS image_store (
    key TEXT PRIMARY KEY NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_ratings_game_key ON ratings(game_key);
CREATE INDEX IF NOT EXISTS idx_ratings_uid ON ratings(uid);
CREATE INDEX IF NOT EXISTS idx_ratings_game_score ON ratings(game_key, score);
CREATE INDEX IF NOT EXISTS idx_community_votes_month_game ON community_votes(month, game_key);
CREATE INDEX IF NOT EXISTS idx_community_votes_uid ON community_votes(uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_library_uid ON user_library(uid);
CREATE INDEX IF NOT EXISTS idx_user_library_status ON user_library(uid, status);
CREATE INDEX IF NOT EXISTS idx_user_library_updated ON user_library(uid, server_updated_at);
CREATE INDEX IF NOT EXISTS idx_game_covers_key ON game_covers(game_key);
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
CREATE INDEX IF NOT EXISTS idx_image_store_key ON image_store(key);

-- Public community tables (also available as a versioned migration).
CREATE TABLE IF NOT EXISTS community_profiles (
 uid TEXT PRIMARY KEY, nickname TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
 share_library INTEGER NOT NULL DEFAULT 1, suspended INTEGER NOT NULL DEFAULT 0,
 avatar_preset TEXT, banner_preset TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS community_library (
 uid TEXT NOT NULL, game_key TEXT NOT NULL, title TEXT NOT NULL, steam_id INTEGER,
 cover_url TEXT, status TEXT NOT NULL, playtime_minutes INTEGER NOT NULL DEFAULT 0,
 recorded_playtime_minutes INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS user_sync_state (
 uid TEXT PRIMARY KEY NOT NULL,
 sync_epoch INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
