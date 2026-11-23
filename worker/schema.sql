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
    last_played TEXT,
    user_score REAL,
    user_notes TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    client_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (uid, game_key)
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
