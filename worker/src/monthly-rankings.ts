import type { MonthlyGameRanking, MonthlyRankings } from "../../src/shared/community.ts";
import {
  currentRankingMonth, FIRST_RANKING_MONTH, MONTHLY_TIMEZONE,
  monthlyRatingScore, rankingMonthBounds, RATING_PRIOR_SCORE, RATING_PRIOR_WEIGHT,
} from "../../src/shared/monthly.ts";
import { CommunityError, publicUrl } from "./community-common.ts";
import type { Env } from "./types.ts";
import { IDLE_APP_KEYS, IDLE_APP_TITLES } from "./ranking-eligibility.ts";

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

const canonical = (key: string) => `CASE WHEN ul.steam_id>0 THEN CAST(ul.steam_id AS TEXT)
  WHEN alias.steam_id>0 THEN CAST(alias.steam_id AS TEXT)
  WHEN ${key} GLOB 's_[0-9]*' THEN SUBSTR(${key},3) ELSE ${key} END`;

export async function getMonthlyRankings(env: Env, month: string, limit = 20, now = new Date()): Promise<MonthlyRankings> {
  const currentMonth = currentRankingMonth(now);
  const bounds = rankingMonthBounds(month);
  if (!bounds || month < FIRST_RANKING_MONTH || month > currentMonth)
    throw new CommunityError("Invalid ranking month; choose November 2026 or a later completed/current month");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new CommunityError("Ranking limit must be between 1 and 50");
  const start = new Date(bounds.start).toISOString(), end = new Date(Math.min(bounds.end, now.getTime() + 1)).toISOString();

  const [sessions, reviews] = await Promise.all([
    env.DB.prepare(`SELECT s.uid,l.game_key AS gameKey,l.title,l.steam_id AS steamId,
      COALESCE(gc.cover_url,l.cover_url) AS coverUrl,gc.banner_url AS bannerUrl,
      COALESCE(gm.classification,'unknown') AS classification,
      s.start_time AS startTime,s.end_time AS endTime,s.duration_minutes AS durationMinutes
      FROM user_sessions s
      LEFT JOIN user_library ul ON ul.uid=s.uid AND ul.game_key=s.game_key
      LEFT JOIN game_covers alias ON alias.game_key=s.game_key
      JOIN community_library l ON l.uid=s.uid AND l.game_key=${canonical("s.game_key")}
      JOIN community_profiles cp ON cp.uid=s.uid
      LEFT JOIN game_metadata gm ON gm.game_key=l.game_key
      LEFT JOIN game_covers gc ON gc.game_key=l.game_key
      WHERE cp.share_library=1 AND cp.suspended=0 AND s.source IN ('tracker','amd_import')
        AND s.duration_minutes>0 AND LOWER(l.game_key) NOT IN ${IDLE_APP_KEYS}
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
      COALESCE(gm.classification,'unknown') AS classification,h.score,h.effective_at AS effectiveAt
    FROM latest h JOIN users u ON u.uid=h.uid
    LEFT JOIN community_profiles cp ON cp.uid=h.uid
    LEFT JOIN game_metadata gm ON gm.game_key=h.canonical_key
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
  for (const row of sessions.results || []) {
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
    let game = games.get(row.gameKey);
    if (!game) {
      game = {
        gameKey: row.gameKey, title: row.title, steamId: row.steamId,
        coverUrl: publicUrl(row.coverUrl), bannerUrl: publicUrl(row.bannerUrl),
        classification: row.classification, players: 0, totalMinutes: 0,
        averageScore: null, reviewCount: 0, rankingScore: null,
        scoreTotal: 0, participants: new Set(),
      };
      games.set(row.gameKey, game);
    }
    return game;
  };
  for (const { game: row, intervals } of activity.values()) {
    const game = gameFor(row);
    game.totalMinutes += mergedMinutes(intervals);
    game.participants.add(row.uid);
  }
  for (const row of reviews.results || []) {
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
  const singlePlayer = candidates.filter(g => (g.classification === "offline" || g.classification === "hybrid") && g.reviewCount > 0)
    .sort((a, b) => b.rankingScore! - a.rankingScore! || b.reviewCount - a.reviewCount || b.averageScore! - a.averageScore! || titleOrder(a, b));
  return {
    month, currentMonth, firstMonth: FIRST_RANKING_MONTH, timezone: MONTHLY_TIMEZONE,
    state: month === currentMonth ? "live" : "ended", updatedAt: now.toISOString(),
    scoring: { priorScore: RATING_PRIOR_SCORE, priorWeight: RATING_PRIOR_WEIGHT },
    online: online.slice(0, limit), singlePlayer: singlePlayer.slice(0, limit),
    onlineCount: online.length, singlePlayerCount: singlePlayer.length,
    unclassifiedCount: candidates.filter(g => g.classification === "unknown").length,
  };
}
