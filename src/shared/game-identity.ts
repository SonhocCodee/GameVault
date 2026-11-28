/**
 * Shared identity rules for games that do not have a stable Steam app ID.
 * Unknown titles keep the existing title-derived key; known aliases converge
 * on one community identity.
 */
export interface NonSteamGameIdentity {
  gameKey: string;
  title: string;
  titleAliases: readonly string[];
  keyAliases?: readonly string[];
}

export const NON_STEAM_GAME_IDENTITIES: readonly NonSteamGameIdentity[] = [
  {
    gameKey: "t_leagueoflegends",
    title: "League of Legends",
    titleAliases: ["League of Legends", "Liên Minh Huyền Thoại", "LoL"],
    // This is the title key created by older GameVault builds before aliases
    // were canonicalized.
    keyAliases: ["t_linminhhuynthoi"],
  },
  {
    gameKey: "t_valorant",
    title: "VALORANT",
    titleAliases: ["VALORANT"],
  },
  {
    gameKey: "t_roblox",
    title: "Roblox",
    titleAliases: ["Roblox", "Roblox Player", "RobloxPlayerBeta"],
  },
];

function legacyTitleToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unicodeTitleToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const identityByKey = new Map<string, NonSteamGameIdentity>();
for (const identity of NON_STEAM_GAME_IDENTITIES) {
  identityByKey.set(identity.gameKey.toLowerCase(), identity);
  for (const alias of identity.keyAliases || []) {
    identityByKey.set(alias.toLowerCase(), identity);
  }
  for (const title of identity.titleAliases) {
    identityByKey.set(`t_${legacyTitleToken(title)}`, identity);
    identityByKey.set(`t_${unicodeTitleToken(title)}`, identity);
  }
}

/** Preserve the historic fallback key for non-Steam titles. */
export function canonicalNonSteamGameKeyFromTitle(title: string): string {
  const key = `t_${legacyTitleToken(String(title || ""))}`;
  return identityByKey.get(key)?.gameKey || key;
}

/** Map an existing title-derived key to its registered community identity. */
export function canonicalNonSteamGameKey(gameKey: string): string {
  const key = String(gameKey || "").trim();
  return identityByKey.get(key.toLowerCase())?.gameKey || key;
}

export function canonicalNonSteamGameTitle(gameKey: string, fallback: string): string {
  return identityByKey.get(String(gameKey || "").trim().toLowerCase())?.title || fallback;
}

/** Build the matching CASE expression used by D1 grouping and joins. */
export function canonicalNonSteamGameKeySql(expression: string): string {
  const aliases = [...identityByKey.entries()]
    .filter(([alias, identity]) => alias !== identity.gameKey.toLowerCase())
    .sort(([a], [b]) => a.localeCompare(b));
  if (!aliases.length) return expression;

  const cases = aliases
    .map(([alias, identity]) => `WHEN '${alias}' THEN '${identity.gameKey}'`)
    .join(" ");
  return `CASE LOWER(TRIM(${expression})) ${cases} ELSE ${expression} END`;
}

/** Canonical display title for a known identity, with the original as fallback. */
export function canonicalNonSteamGameTitleSql(
  keyExpression: string,
  titleExpression: string,
): string {
  const identities = [...new Map(
    NON_STEAM_GAME_IDENTITIES.map((identity) => [identity.gameKey, identity]),
  ).values()];
  const cases = identities
    .map((identity) => {
      const key = identity.gameKey.replace(/'/g, "''");
      const title = identity.title.replace(/'/g, "''");
      return `WHEN '${key}' THEN '${title}'`;
    })
    .join(" ");
  return `CASE LOWER(TRIM(${keyExpression})) ${cases} ELSE ${titleExpression} END`;
}
