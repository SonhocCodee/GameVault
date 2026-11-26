-- Preserve every existing total as the accepted baseline. Only subsequent
-- manually added time is excluded from recorded-time rankings.
ALTER TABLE user_library ADD COLUMN recorded_playtime_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_library ADD COLUMN recorded_playtime_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE user_library SET recorded_playtime_minutes = playtime_minutes;
UPDATE community_library SET recorded_playtime_minutes = playtime_minutes;
