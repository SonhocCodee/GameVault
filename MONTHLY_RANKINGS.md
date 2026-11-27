# Monthly community rankings

The shared desktop/web **Game thang nay** panel starts in November 2026. Its year/month navigation never offers an earlier or future month. Month boundaries use Asia/Ho_Chi_Minh (UTC+7).

## Ranking rules

- **Online:** games classified as `online`, ordered by recorded minutes in the selected month, then distinct tracked players and title. Lifetime totals, manually entered time and review scores do not determine the order.
- **Single-player:** `offline` and `hybrid` games with at least one eligible review. The ranking score is `(averageScore * reviewCount + 7 * 5) / (reviewCount + 5)`. Ties use review count, average score, title and game key, never playtime. The interface shows both the original average and the adjusted ranking score.
- A reviewer qualifies through a recorded session or a new/changed public review in that month. Each player has one score per canonical game, including Steam-key aliases. Unclassified games are counted separately instead of being assumed offline.
- The existing background-app exclusions, moderation and library-sharing rules apply. Public API responses contain no player identities.

## Time and historical data

Only timestamped, non-manual `tracker` and `amd_import` sessions count. Intervals are clipped at the month boundaries and the current time, capped by recorded duration/end time, and merged per player/game to prevent overlapping imports from counting twice. Legacy offset-free tracker timestamps are interpreted as Vietnam wall time. Lifetime totals are never allocated retroactively.

Migration `0009_monthly_rankings.sql` creates rating history and insert/update/delete triggers. Historical months use the latest known score before the end of that month. Repeated synchronization of an unchanged review does not create a new vote or activity event. Existing reviews are seeded with their latest surviving score and update timestamp; older overwritten versions cannot be reconstructed.

Historical boards are recomputed from dated records, rather than permanently frozen snapshots: late synchronized sessions belong to their original month, and metadata/moderation corrections can affect archived results. Removing all public community data also purges rating history while preserving the private cloud library.

## Deployment and verification

Apply the versioned migration to the target D1 database before deploying the updated Worker and frontends. The new public endpoint is `GET /api/community/rankings/monthly?month=YYYY-MM&limit=20` (maximum 50 rows per board).

Focused cases are in `tests/monthly-rankings.test.js`. Run them and the normal Electron test suite, TypeScript checking, both frontend builds, the UTF-8 checker, and responsive browser checks when changing this feature.
