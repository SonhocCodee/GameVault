ALTER TABLE community_profiles ADD COLUMN avatar_preset TEXT;
ALTER TABLE community_profiles ADD COLUMN banner_preset TEXT;

UPDATE community_profiles SET share_library=1;

INSERT OR IGNORE INTO community_profiles(uid,nickname,share_library)
SELECT uid,CASE WHEN TRIM(COALESCE(display_name,''))='' OR display_name LIKE '%@%'
 THEN 'Player' ELSE SUBSTR(TRIM(display_name),1,60) END,1 FROM users;

INSERT INTO community_library(uid,game_key,title,steam_id,cover_url,status,playtime_minutes)
SELECT l.uid,CASE WHEN l.steam_id>0 THEN CAST(l.steam_id AS TEXT) ELSE l.game_key END,
 MAX(l.title),MAX(CASE WHEN l.steam_id>0 THEN l.steam_id ELSE NULL END),MAX(l.cover_url),
 CASE WHEN MAX(CASE WHEN l.status='completed' THEN 1 ELSE 0 END)=1 THEN 'completed' ELSE MAX(l.status) END,
 MAX(l.playtime_minutes)
FROM user_library l JOIN community_profiles p ON p.uid=l.uid
WHERE l.is_deleted=0 AND p.suspended=0
GROUP BY l.uid,CASE WHEN l.steam_id>0 THEN CAST(l.steam_id AS TEXT) ELSE l.game_key END
ON CONFLICT(uid,game_key) DO UPDATE SET title=excluded.title,steam_id=excluded.steam_id,
 cover_url=excluded.cover_url,status=excluded.status,playtime_minutes=excluded.playtime_minutes;
