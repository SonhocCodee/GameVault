CREATE INDEX IF NOT EXISTS idx_user_library_uid_server_updated
  ON user_library(uid, server_updated_at DESC);
