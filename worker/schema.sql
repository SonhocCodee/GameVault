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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_ratings_game_key ON ratings(game_key);
CREATE INDEX IF NOT EXISTS idx_ratings_uid ON ratings(uid);
CREATE INDEX IF NOT EXISTS idx_ratings_game_score ON ratings(game_key, score);
CREATE INDEX IF NOT EXISTS idx_community_votes_month_game ON community_votes(month, game_key);
CREATE INDEX IF NOT EXISTS idx_community_votes_uid ON community_votes(uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
