import type { D1Database, Env } from './types.ts';

export type GameClassification = 'online' | 'hybrid' | 'offline' | 'unknown';
type GameInput = { gameKey: string; title: string; steamId?: number | null };
type ClassificationResult = {
  classification: GameClassification;
  source: string;
  confidence: number;
  evidence: Record<string, unknown>;
};

const MAX_AGE_DAYS = 30;
let metadataFetch: typeof fetch | undefined;
let twitchToken: { clientId: string; token: string; expiresAt: number } | null = null;
let inFlight = new WeakMap<D1Database, Map<string, Promise<ClassificationResult>>>();
let igdbQueue: Promise<unknown> = Promise.resolve();
let nextIgdbRequest = 0;

export function configureGameMetadata(fetcher?: typeof fetch) {
  metadataFetch = fetcher;
  twitchToken = null;
  inFlight = new WeakMap();
  igdbQueue = Promise.resolve();
  nextIgdbRequest = 0;
}

async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const response = await (metadataFetch || fetch)(url, {
    ...init,
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error(`Metadata upstream HTTP ${response.status}`);
  return response.json();
}

/** Category IDs are provider schema values, not a list of game titles. */
export function classifySteam(data: any): ClassificationResult {
  const ids = new Set<number>((Array.isArray(data?.categories) ? data.categories : []).map((c: any) => Number(c.id)));
  const single = ids.has(2);
  const competitive = ids.has(20) || ids.has(36);
  const online = competitive || ids.has(38);
  const multiplayer = ids.has(1) || online;
  const classification: GameClassification = single ? 'offline'
    : multiplayer ? 'online'
    : 'unknown';
  return { classification, source: 'steam', confidence: classification === 'unknown' ? 0 : 0.9,
    evidence: { categories: [...ids], singlePlayer: single, online, multiplayer } };
}

export function classifyIgdb(data: any): ClassificationResult {
  const ids = new Set<number>((Array.isArray(data?.game_modes) ? data.game_modes : []).map((m: any) => Number(typeof m === 'object' ? m.id : m)));
  const modes = Array.isArray(data?.multiplayer_modes) ? data.multiplayer_modes : [];
  const single = ids.has(1);
  const competitive = ids.has(5) || ids.has(6);
  const onlineCoop = ids.has(3) && modes.some((m: any) => m.onlinecoop === true);
  const online = competitive || onlineCoop || modes.some((m: any) => Number(m.onlinemax) > 1);
  const offlineCoop = ids.has(3) && modes.some((m: any) => m.offlinecoop === true || m.campaigncoop === true);
  const multiplayer = ids.has(2) || online;
  const classification: GameClassification = single || offlineCoop ? 'offline'
    : multiplayer ? 'online'
    : 'unknown';
  return { classification, source: 'igdb', confidence: classification === 'unknown' ? 0 : online ? 0.85 : 0.7,
    evidence: { igdbId: data?.id, gameModes: [...ids], multiplayerModes: modes } };
}

async function igdbAuth(env: Env): Promise<{ clientId: string; token: string } | null> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return null;
  if (twitchToken && twitchToken.clientId === env.TWITCH_CLIENT_ID && twitchToken.expiresAt > Date.now()) return twitchToken;
  const params = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const result = await requestJson('https://id.twitch.tv/oauth2/token', { method: 'POST', body: params });
  if (!result.access_token) return null;
  twitchToken = { clientId: env.TWITCH_CLIENT_ID, token: result.access_token, expiresAt: Date.now() + Math.max(60, Number(result.expires_in || 3600) - 300) * 1000 };
  return twitchToken;
}

function normalizedTitle(title: string) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadIgdb(env: Env, game: GameInput): Promise<ClassificationResult | null> {
  const auth = await igdbAuth(env);
  if (!auth) return null;
  const fields = 'fields name,alternative_names.name,game_modes,multiplayer_modes.*;';
  const post = (body: string) => {
    const run = igdbQueue.catch(() => {}).then(async () => {
      const delay = Math.max(0, nextIgdbRequest - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextIgdbRequest = Date.now() + 275;
      return requestJson('https://api.igdb.com/v4/games', {
        method: 'POST', headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}`, Accept: 'application/json' }, body,
      });
    });
    igdbQueue = run;
    return run;
  };
  if (game.steamId && game.steamId > 0) {
    const linked = await post(`${fields} where external_games.category = 1 & external_games.uid = "${game.steamId}"; limit 2;`);
    if (Array.isArray(linked) && linked.length === 1) return classifyIgdb(linked[0]);
  }
  const escaped = game.title.replace(/["\\]/g, ' ').slice(0, 160);
  const rows = await post(`search "${escaped}"; ${fields} limit 10;`);
  if (!Array.isArray(rows)) return null;
  const wanted = normalizedTitle(game.title);
  const matches = rows.filter((r: any) => [r.name, ...(r.alternative_names || []).map((a: any) => a.name)]
    .some(name => typeof name === 'string' && normalizedTitle(name) === wanted));
  return matches.length === 1 ? classifyIgdb(matches[0]) : null;
}

async function resolveMetadata(env: Env, game: GameInput): Promise<ClassificationResult> {
  if (game.steamId && game.steamId > 0) {
    try {
      const result = await requestJson(`https://store.steampowered.com/api/appdetails?appids=${game.steamId}&l=english&cc=us`);
      const entry = result?.[String(game.steamId)];
      if (entry?.success && entry.data) {
        const steam = classifySteam(entry.data);
        if (steam.classification !== 'unknown') return steam;
      }
    } catch { /* Try the cross-store provider when Steam is unavailable. */ }
  }
  try {
    const igdb = await loadIgdb(env, game);
    if (igdb) return igdb;
  } catch { /* Missing metadata remains unknown and will be retried. */ }
  return { classification: 'unknown', source: 'unknown', confidence: 0, evidence: {} };
}

export async function ensureGameMetadata(env: Env, game: GameInput, force = false): Promise<ClassificationResult> {
  const numeric = game.steamId && game.steamId > 0 ? game.steamId : /^s_\d+$/.test(game.gameKey) ? Number(game.gameKey.slice(2)) : /^\d+$/.test(game.gameKey) ? Number(game.gameKey) : null;
  game = { ...game, gameKey: numeric ? String(numeric) : game.gameKey, steamId: numeric };
  const existing = await env.DB.prepare('SELECT * FROM game_metadata WHERE game_key=?').bind(game.gameKey).first<any>();
  const age = existing ? Date.now() - Date.parse(existing.fetched_at.replace(' ', 'T') + 'Z') : Infinity;
  const ttl = (existing?.classification === 'unknown' ? 1 : MAX_AGE_DAYS) * 86400000;
  if (existing && (existing.source === 'manual' || (!force && age < ttl))) {
    return { classification: existing.classification, source: existing.source, confidence: existing.confidence, evidence: JSON.parse(existing.evidence_json || '{}') };
  }
  const flightKey = game.gameKey;
  let flights = inFlight.get(env.DB);
  if (!flights) { flights = new Map(); inFlight.set(env.DB, flights); }
  if (flights.has(flightKey)) return flights.get(flightKey)!;
  const work = (async () => {
    const result = await resolveMetadata(env, game);
    // A temporary provider outage must not erase a known classification.
    if (result.classification === 'unknown' && existing?.classification !== 'unknown' && existing) {
      return { classification: existing.classification, source: existing.source, confidence: existing.confidence, evidence: JSON.parse(existing.evidence_json || '{}') };
    }
    await env.DB.prepare(`INSERT INTO game_metadata(game_key,title,steam_id,classification,source,confidence,evidence_json,fetched_at,updated_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(game_key) DO UPDATE SET
      title=excluded.title,steam_id=excluded.steam_id,classification=excluded.classification,source=excluded.source,
      confidence=excluded.confidence,evidence_json=excluded.evidence_json,fetched_at=excluded.fetched_at,updated_at=excluded.updated_at
      WHERE game_metadata.source!='manual'`)
      .bind(game.gameKey, game.title, game.steamId || null, result.classification, result.source, result.confidence, JSON.stringify(result.evidence)).run();
    return result;
  })();
  flights.set(flightKey, work);
  try { return await work; } finally { flights.delete(flightKey); }
}

/** Bounded refresh; metadata fetches are serialized to respect provider limits. */
export async function refreshCatalogMetadata(env: Env, limit = 2): Promise<number> {
  const rows = (await env.DB.prepare(`WITH raw AS (
      SELECT game_key,title,steam_id FROM game_covers
      UNION ALL SELECT game_key,title,steam_id FROM community_library
      UNION ALL SELECT game_key,game_title AS title,NULL AS steam_id FROM ratings
    ), catalog AS (
      SELECT CASE WHEN steam_id>0 THEN CAST(steam_id AS TEXT) WHEN game_key GLOB 's_[0-9]*' THEN SUBSTR(game_key,3) ELSE game_key END AS game_key,
        MAX(title) AS title,MAX(steam_id) AS steam_id FROM raw GROUP BY 1
    ) SELECT c.game_key AS gameKey,c.title,c.steam_id AS steamId
    FROM catalog c LEFT JOIN game_metadata m ON m.game_key=c.game_key
    WHERE m.game_key IS NULL OR (m.source!='manual' AND m.fetched_at < datetime('now',CASE WHEN m.classification='unknown' THEN '-1 day' ELSE '-30 days' END))
    ORDER BY m.fetched_at,c.game_key LIMIT ?`).bind(limit).all<any>()).results || [];
  for (const game of rows) await ensureGameMetadata(env, game);
  return rows.length;
}

export function queueMetadataRefresh(env: Env, executionCtx: any): void {
  if (executionCtx?.waitUntil) executionCtx.waitUntil(refreshCatalogMetadata(env, 5).catch(error => console.warn('[game-metadata]', error)));
}
