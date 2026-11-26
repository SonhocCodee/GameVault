CREATE TABLE IF NOT EXISTS community_follows (
    uid TEXT NOT NULL,
    followed_uid TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (uid, followed_uid),
    CHECK (uid <> followed_uid)
);
CREATE INDEX IF NOT EXISTS idx_community_followers ON community_follows(followed_uid, uid);
