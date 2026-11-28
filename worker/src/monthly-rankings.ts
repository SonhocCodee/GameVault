import type {
  MonthlyGameRanking,
  MonthlyPlayerRankings,
  MonthlyRankings,
  PlayerRanking,
  SharedLibraryGame,
} from "../../src/shared/community.ts";
import {
  currentRankingMonth, FIRST_PLAYER_RANKING_MONTH, FIRST_RANKING_MONTH, MONTHLY_TIMEZONE,
  monthlyRatingScore, rankingMonthBounds, RATING_PRIOR_SCORE, RATING_PRIOR_WEIGHT,
} from "../../src/shared/monthly.ts";
import { communityAvatar, CommunityError, publicUrl, safeName, visibleTo } from "./community-common.ts";
import type { Env } from "./types.ts";
import { IDLE_APP_KEYS, IDLE_APP_TITLES } from "./ranking-eligibility.ts";
import {
  canonicalNonSteamGameKey,
  canonicalNonSteamGameKeySql,
  canonicalNonSteamGameTitle,
} from "../../src/shared/game-identity.ts";

type GameData = {
  uid: string; gameKey: string; title: string; steamId: number | null;
  coverUrl: string | null; bannerUrl: string | null;
  classification: MonthlyGameRanking["classification"];
};
type SessionRow = GameData & { startTime: string; endTime: string | null; durationMinutes: number };
type ReviewRow = GameData & { score: number; effectiveAt: string };
type Interval = [number, number];

// Local SQLite tracker timestamps have no offset; they are Vietnam wall time.
export function sessionTimestamp(value: string | null): number {
  if (!value) return NaN;
  const normalized = value.trim().replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+07:00`);
}

export function recordedInterval(row: Pick<SessionRow, "startTime" | "endTime" | "durationMinutes">, now: number): Interval | null {
  const start = sessionTimestamp(row.startTime);
  const duration = Number(row.durationMinutes) * 60000;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
  const recordedEnd = start + duration;
  const statedEnd = sessionTimestamp(row.endTime);
  const end = Math.min(recordedEnd, Number.isFinite(statedEnd) ? statedEnd : recordedEnd, now);
  return end > start ? [start, end] : null;
}

export function mergedMinutes(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0, start = 0, end = 0;
  for (const interval of sorted) {
    if (interval[0] > end) {
      total += end - start;
      [start, end] = interval;
    } else end = Math.max(end, interval[1]);
  }
  return Math.round((total + end - start) / 60) / 1000;
}

const canonical = (
  key: string,
  userLibraryAlias = "ul",
  gameCoverAlias = "alias",
) => `CASE WHEN ${userLibraryAlias}.steam_id>0 THEN CAST(${userLibraryAlias}.steam_id AS TEXT)
  WHEN ${gameCoverAlias}.steam_id>0 THEN CAST(${gameCoverAlias}.steam_id AS TEXT)
  WHEN ${key} GLOB 's_[0-9]*' THEN SUBSTR(${key},3)
  ELSE ${canonicalNonSteamGameKeySql(key)} END`;

export async function getMonthlyRankings(env: Env, month: string, limit = 20, now = new Date()): Promise<MonthlyRankings> {
  const currentMonth = currentRankingMonth(now);
  const bounds = rankingMonthBounds(month);
  if (!bounds || month < FIRST_RANKING_MONTH || month > currentMonth)
    throw new CommunityError("Invalid ranking month; choose November 2026 or a later completed/current month");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new CommunityError("Ranking limit must be between 1 and 50");
  const start = new Date(bounds.start).toISOString(), end = new Date(Math.min(bounds.end, now.getTime() + 1)).toISOString();
  const libraryCanonical = canonical("l.game_key", "ul_l", "alias_l");
  const sessionCanonical = canonical("s.game_key", "ul_s", "alias_s");

  const [sessions, reviews] = await Promise.all([
    env.DB.prepare(`WITH library_rows AS (
      SELECT l.*,${libraryCanonical} AS canonicalKey,
        ROW_NUMBER() OVER (PARTITION BY l.uid,${libraryCanonical}
          ORDER BY CASE WHEN LOWER(l.game_key)=LOWER(${libraryCanonical}) THEN 0 ELSE 1 END,LOWER(l.title)) AS canonicalRank
      FROM community_library l
      LEFT JOIN user_library ul_l ON ul_l.uid=l.uid AND ul_l.game_key=l.game_key
      LEFT JOIN game_covers alias_l ON alias_l.game_key=l.game_key
    )
    SELECT s.uid,l.canonicalKey AS gameKey,l.title,COALESCE(gc.steam_id,l.steam_id,aliasCover.steam_id) AS steamId,
      COALESCE(gc.cover_url,aliasCover.cover_url,l.cover_url) AS coverUrl,
      COALESCE(gc.banner_url,aliasCover.banner_url) AS bannerUrl,
      COALESCE(gm.classification,gmAlias.classification,'unknown') AS classification,
      s.start_time AS startTime,s.end_time AS endTime,s.duration_minutes AS durationMinutes
      FROM user_sessions s
      LEFT JOIN user_library ul_s ON ul_s.uid=s.uid AND ul_s.game_key=s.game_key
      LEFT JOIN game_covers alias_s ON alias_s.game_key=s.game_key
      JOIN library_rows l ON l.uid=s.uid AND l.canonicalKey=${sessionCanonical} AND l.canonicalRank=1
      JOIN community_profiles cp ON cp.uid=s.uid
      LEFT JOIN game_metadata gm ON gm.game_key=l.canonicalKey
      LEFT JOIN game_metadata gmAlias ON gmAlias.game_key=l.game_key
      LEFT JOIN game_covers gc ON gc.game_key=l.canonicalKey
      LEFT JOIN game_covers aliasCover ON aliasCover.game_key=l.game_key
      WHERE cp.share_library=1 AND cp.suspended=0 AND s.source IN ('tracker','amd_import')
        AND s.duration_minutes>0 AND LOWER(l.canonicalKey) NOT IN ${IDLE_APP_KEYS}
        AND LOWER(TRIM(l.title)) NOT IN ${IDLE_APP_TITLES}
        AND julianday(s.start_time)<julianday(?,'+1 day')
        AND julianday(s.start_time,'+' || s.duration_minutes || ' minutes')>julianday(?,'-1 day')`)
      .bind(end, start).all<SessionRow>(),
    env.DB.prepare(`WITH mapped AS (
      SELECT h.*,${canonical("h.game_key")} AS canonical_key
      FROM community_rating_history h
      LEFT JOIN user_library ul ON ul.uid=h.uid AND ul.game_key=h.game_key
      LEFT JOIN game_covers alias ON alias.game_key=h.game_key
      WHERE julianday(h.effective_at)<julianday(?)
    ), latest AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY uid,canonical_key ORDER BY julianday(effective_at) DESC,id DESC) AS position
      FROM mapped
    )
    SELECT h.uid,h.canonical_key AS gameKey,COALESCE(gc.title,h.game_title) AS title,
      COALESCE(gc.steam_id,CASE WHEN h.canonical_key NOT GLOB '*[^0-9]*' THEN CAST(h.canonical_key AS INTEGER) END) AS steamId,
      COALESCE(gc.cover_url,h.cover_url) AS coverUrl,gc.banner_url AS bannerUrl,
      COALESCE(gm.classification,gmAlias.classification,'unknown') AS classification,h.score,h.effective_at AS effectiveAt
    FROM latest h JOIN users u ON u.uid=h.uid
    LEFT JOIN community_profiles cp ON cp.uid=h.uid
      LEFT JOIN game_metadata gm ON gm.game_key=h.canonical_key
      LEFT JOIN game_metadata gmAlias ON gmAlias.game_key=h.game_key
    LEFT JOIN game_covers gc ON gc.game_key=h.canonical_key
    WHERE h.position=1 AND h.score BETWEEN 1 AND 10
      AND COALESCE(cp.suspended,0)=0
      AND NOT EXISTS (SELECT 1 FROM community_review_meta m WHERE m.uid=h.uid AND m.hidden=1
        AND (m.game_key=h.game_key OR m.game_key=h.canonical_key OR m.game_key='s_' || h.canonical_key))
      AND LOWER(h.canonical_key) NOT IN ${IDLE_APP_KEYS}
      AND LOWER(TRIM(COALESCE(gc.title,h.game_title))) NOT IN ${IDLE_APP_TITLES}`)
      .bind(end).all<ReviewRow>(),
  ]);

  const activity = new Map<string, { game: GameData; intervals: Interval[] }>();
  for (const sourceRow of sessions.results || []) {
    const gameKey = canonicalNonSteamGameKey(sourceRow.gameKey);
    const row = {
      ...sourceRow,
      gameKey,
      title: canonicalNonSteamGameTitle(gameKey, sourceRow.title),
    };
    const interval = recordedInterval(row, now.getTime());
    if (!interval) continue;
    const clipped: Interval = [Math.max(interval[0], bounds.start), Math.min(interval[1], bounds.end)];
    if (clipped[1] <= clipped[0]) continue;
    const id = `${row.uid}\0${row.gameKey}`;
    const item = activity.get(id) || { game: row, intervals: [] };
    item.intervals.push(clipped);
    activity.set(id, item);
  }

  const games = new Map<string, MonthlyGameRanking & { scoreTotal: number; participants: Set<string> }>();
  const gameFor = (row: GameData) => {
    const gameKey = canonicalNonSteamGameKey(row.gameKey);
    let game = games.get(gameKey);
    if (!game) {
      game = {
        gameKey, title: canonicalNonSteamGameTitle(gameKey, row.title), steamId: row.steamId,
        coverUrl: publicUrl(row.coverUrl), bannerUrl: publicUrl(row.bannerUrl),
        classification: row.classification, players: 0, totalMinutes: 0,
        averageScore: null, reviewCount: 0, rankingScore: null,
        scoreTotal: 0, participants: new Set(),
      };
      games.set(gameKey, game);
    }
    return game;
  };
  for (const { game: row, intervals } of activity.values()) {
    const game = gameFor(row);
    game.totalMinutes += mergedMinutes(intervals);
    game.participants.add(row.uid);
  }
  for (const sourceRow of reviews.results || []) {
    const gameKey = canonicalNonSteamGameKey(sourceRow.gameKey);
    const row = {
      ...sourceRow,
      gameKey,
      title: canonicalNonSteamGameTitle(gameKey, sourceRow.title),
    };
    const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(row.effectiveAt) ? row.effectiveAt : `${row.effectiveAt.replace(" ", "T")}Z`);
    // A public review made this month also qualifies games without a synced session.
    if (timestamp < bounds.start && !activity.has(`${row.uid}\0${row.gameKey}`)) continue;
    const game = gameFor(row);
    game.scoreTotal += Number(row.score);
    game.reviewCount++;
  }
  const candidates = [...games.values()].map(({ scoreTotal, participants, ...game }) => ({
    ...game,
    players: participants.size,
    totalMinutes: Math.round(game.totalMinutes * 1000) / 1000,
    averageScore: game.reviewCount ? scoreTotal / game.reviewCount : null,
    rankingScore: game.reviewCount ? monthlyRatingScore(scoreTotal / game.reviewCount, game.reviewCount) : null,
  }));
  const titleOrder = (a: MonthlyGameRanking, b: MonthlyGameRanking) =>
    a.title.localeCompare(b.title, "vi") || a.gameKey.localeCompare(b.gameKey);
  const online = candidates.filter(g => g.classification === "online" && g.totalMinutes > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes || b.players - a.players || titleOrder(a, b));
  const singlePlayer = candidates.filter(g => (g.classification === "offline" || g.classification === "hybrid") && g.totalMinutes > 0 && g.reviewCount > 0)
    .sort((a, b) => b.averageScore! - a.averageScore! || b.reviewCount - a.reviewCount || titleOrder(a, b));
  return {
    month, currentMonth, firstMonth: FIRST_RANKING_MONTH, timezone: MONTHLY_TIMEZONE,
    state: month === currentMonth ? "live" : "ended", updatedAt: now.toISOString(),
    scoring: { priorScore: RATING_PRIOR_SCORE, priorWeight: RATING_PRIOR_WEIGHT },
    online: online.slice(0, limit), singlePlayer: singlePlayer.slice(0, limit),
    onlineCount: online.length, singlePlayerCount: singlePlayer.length,
    unclassifiedCount: candidates.filter(g => g.classification === "unknown").length,
  };
}

type PlayerSessionRow = {
  uid: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  gameKey: string;
  title: string;
  steamId: number | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  status: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
};

export async function getMonthlyPlayerRankings(
  env: Env,
  month: string,
  options: {
    limit?: number;
    offset?: number;
    includeTopGames?: boolean;
    viewerUid?: string;
    request?: Request;
  } = {},
  now = new Date(),
): Promise<MonthlyPlayerRankings> {
  const currentMonth = currentRankingMonth(now);
  const bounds = rankingMonthBounds(month);
  if (!bounds || month < FIRST_PLAYER_RANKING_MONTH || month > currentMonth) {
    throw new CommunityError("Invalid monthly player ranking month; choose December 2026 or a later completed/current month");
  }
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new CommunityError("Ranking limit must be between 1 and 50");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new CommunityError("Ranking offset must be 0 or greater");
  }

  const viewerUid = options.viewerUid || "";
  const includeTopGames = !!options.includeTopGames;
  const start = new Date(bounds.start).toISOString();
  const end = new Date(Math.min(bounds.end, now.getTime() + 1)).toISOString();
  const libraryCanonical = canonical("l.game_key", "ul_l", "alias_l");
  const sessionCanonical = canonical("s.game_key", "ul_s", "alias_s");

  const sessions = await env.DB.prepare(`
    WITH library_rows AS (
      SELECT l.*,${libraryCanonical} AS canonicalKey,
        ROW_NUMBER() OVER (PARTITION BY l.uid,${libraryCanonical}
          ORDER BY CASE WHEN LOWER(l.game_key)=LOWER(${libraryCanonical}) THEN 0 ELSE 1 END,LOWER(l.title)) AS canonicalRank
      FROM community_library l
      LEFT JOIN user_library ul_l ON ul_l.uid=l.uid AND ul_l.game_key=l.game_key
      LEFT JOIN game_covers alias_l ON alias_l.game_key=l.game_key
    )
    SELECT s.uid, cp.nickname, cp.bio,
      COALESCE('/community/profile-presets/avatars/'||cp.avatar_preset||'.svg', u.photo_url) AS avatarUrl,
      l.canonicalKey AS gameKey, l.title, COALESCE(gc.steam_id,l.steam_id,aliasCover.steam_id) AS steamId,
      COALESCE(gc.cover_url,aliasCover.cover_url,l.cover_url) AS coverUrl,
      COALESCE(gc.banner_url,aliasCover.banner_url) AS bannerUrl,
      l.status, s.start_time AS startTime, s.end_time AS endTime, s.duration_minutes AS durationMinutes
    FROM user_sessions s
    LEFT JOIN user_library ul_s ON ul_s.uid=s.uid AND ul_s.game_key=s.game_key
    LEFT JOIN game_covers alias_s ON alias_s.game_key=s.game_key
    JOIN library_rows l ON l.uid=s.uid AND l.canonicalKey=${sessionCanonical} AND l.canonicalRank=1
    JOIN community_profiles cp ON cp.uid=s.uid
    LEFT JOIN users u ON u.uid=s.uid
    LEFT JOIN game_covers gc ON gc.game_key=l.canonicalKey
    LEFT JOIN game_covers aliasCover ON aliasCover.game_key=l.game_key
    WHERE cp.share_library=1 AND cp.suspended=0 AND ${visibleTo("cp")}
      AND s.source IN ('tracker','amd_import') AND s.duration_minutes>0
      AND LOWER(l.canonicalKey) NOT IN ${IDLE_APP_KEYS}
      AND LOWER(TRIM(l.title)) NOT IN ${IDLE_APP_TITLES}
      AND julianday(s.start_time)<julianday(?,'+1 day')
      AND julianday(s.start_time,'+' || s.duration_minutes || ' minutes')>julianday(?,'-1 day')
  `).bind(viewerUid, viewerUid, end, start).all<PlayerSessionRow>();

  type PlayerBucket = {
    uid: string;
    nickname: string | null;
    bio: string | null;
    avatarUrl: string | null;
    allIntervals: Interval[];
    games: Map<string, {
      gameKey: string;
      title: string;
      steamId: number | null;
      coverUrl: string | null;
      bannerUrl: string | null;
      status: string;
      intervals: Interval[];
    }>;
  };

  const byPlayer = new Map<string, PlayerBucket>();
  for (const sourceRow of sessions.results || []) {
    const gameKey = canonicalNonSteamGameKey(sourceRow.gameKey);
    const row = {
      ...sourceRow,
      gameKey,
      title: canonicalNonSteamGameTitle(gameKey, sourceRow.title),
    };
    const interval = recordedInterval(row, now.getTime());
    if (!interval) continue;
    const clipped: Interval = [Math.max(interval[0], bounds.start), Math.min(interval[1], bounds.end)];
    if (clipped[1] <= clipped[0]) continue;

    let bucket = byPlayer.get(row.uid);
    if (!bucket) {
      bucket = {
        uid: row.uid,
        nickname: row.nickname,
        bio: row.bio,
        avatarUrl: row.avatarUrl,
        allIntervals: [],
        games: new Map(),
      };
      byPlayer.set(row.uid, bucket);
    }
    bucket.allIntervals.push(clipped);
    let game = bucket.games.get(row.gameKey);
    if (!game) {
      game = {
        gameKey: row.gameKey,
        title: row.title,
        steamId: row.steamId,
        coverUrl: row.coverUrl,
        bannerUrl: row.bannerUrl,
        status: row.status,
        intervals: [],
      };
      bucket.games.set(row.gameKey, game);
    }
    game.intervals.push(clipped);
  }

  const ranked = [...byPlayer.values()]
    .map((bucket) => {
      const recordedMinutes = Math.round(mergedMinutes(bucket.allIntervals) * 1000) / 1000;
      return { bucket, recordedMinutes };
    })
    .filter((entry) => entry.recordedMinutes > 0)
    .sort((a, b) => b.recordedMinutes - a.recordedMinutes || a.bucket.uid.localeCompare(b.bucket.uid));

  const slice = ranked.slice(offset, offset + limit);
  const completedByUid = new Map<string, number>();
  if (slice.length > 0) {
    const uids = slice.map((s) => s.bucket.uid);
    const placeholders = uids.map(() => "?").join(",");
    const completedRows = (await env.DB.prepare(`
      SELECT uid, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completedGames
      FROM community_library
      WHERE uid IN (${placeholders})
      GROUP BY uid
    `).bind(...uids).all<{ uid: string; completedGames: number }>()).results || [];
    for (const r of completedRows) {
      completedByUid.set(r.uid, Number(r.completedGames) || 0);
    }
  }

  const items: PlayerRanking[] = slice.map(({ bucket, recordedMinutes }) => {
    const avatar = options.request
      ? communityAvatar(options.request, bucket.avatarUrl)
      : publicUrl(bucket.avatarUrl);
    let topGames: SharedLibraryGame[] | undefined;
    let bannerUrl: string | null | undefined;
    if (includeTopGames) {
      const sortedGames = [...bucket.games.values()]
        .map((g) => {
          const mins = Math.round(mergedMinutes(g.intervals) * 1000) / 1000;
          return {
            gameKey: g.gameKey,
            title: canonicalNonSteamGameTitle(g.gameKey, g.title),
            steamId: g.steamId,
            coverUrl: publicUrl(g.coverUrl),
            bannerUrl: publicUrl(g.bannerUrl),
            status: g.status,
            playtimeMinutes: mins,
            recordedPlaytimeMinutes: mins,
          };
        })
        .filter((g) => g.playtimeMinutes > 0)
        .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || a.title.localeCompare(b.title, "vi"))
        .slice(0, 3);
      topGames = sortedGames;
      const topBanner = sortedGames.find((g) => g.bannerUrl || g.coverUrl);
      bannerUrl = topBanner?.bannerUrl || topBanner?.coverUrl || null;
    }

    return {
      uid: bucket.uid,
      nickname: safeName(bucket.nickname),
      ...(avatar ? { avatarUrl: avatar } : {}),
      ...(includeTopGames ? {
        bio: bucket.bio || "",
        bannerUrl,
        topGames,
      } : {}),
      totalGames: bucket.games.size,
      completedGames: completedByUid.get(bucket.uid) || 0,
      totalMinutes: recordedMinutes,
      recordedMinutes,
    };
  });

  return {
    month,
    currentMonth,
    firstMonth: FIRST_PLAYER_RANKING_MONTH,
    timezone: MONTHLY_TIMEZONE,
    state: month === currentMonth ? "live" : "ended",
    updatedAt: now.toISOString(),
    items,
    hasMore: ranked.length > offset + limit,
    nextOffset: offset + items.length,
  };
}
