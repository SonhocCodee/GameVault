# GameVault: unfinished game classification and ranking handoff

Date: 2026-11-26 (Asia/Saigon).
Workspace: `D:/Son/Vibe/Gamevault/GameVault`.
Git HEAD at inspection: `f464608` (`docs(sync): log D1 migration, Worker deploy, and handoff steps`).

## Status and actual stopping point

**The requested feature is unfinished. Backend classification code exists, but the Top Games UI does not expose or send the classification filter.** Do not report the online/offline ranking separation as delivered.

The previous assistant's supplied continuation summary said it could no longer call tools in that session. That summary did not establish a specific build failure, upstream API failure, or deployment failure. This handoff does not invent one.

During this handoff, filesystem reads and shell commands worked. The codebase-memory MCP calls `index_status`, `search_graph`, and `check_index_coverage` returned `Transport closed`. Direct source reads and targeted searches were used instead; graph coverage could not be verified. This tool failure does not prevent editing or completing the feature through normal source tools.

`rtk` is not available in the current PowerShell PATH. Initial prefixed commands failed with command-not-found; subsequent diagnostic commands used the underlying tools directly.

No application code was changed during the handoff. No migration, deployment, authenticated production action, commit, or push was performed during this handoff. The current production version and migration state were not queried.

## User requirements to preserve

- Detect game classification from provider metadata for both Steam and non-Steam games. Avoid maintaining a hardcoded list of game titles or app IDs.
- Allow online games with very large lifetime hours to be separated from other games in rankings. The examples given were League of Legends, Valorant, Apex, and Warzone.
- New releases should be handled through metadata rather than source edits.
- Preserve the existing UI and its red theme. The user reported that another model already improved the UI; inspect and reuse those changes.
- Preserve earlier requested behavior: remove the redundant My Games community tab; show database games in Top Games; support score/hour sorting; a single valid review qualifies for the score ranking, while zero reviews does not; persist scores and written reviews to the server; expose profile activity history.
- Communicate with the user in Vietnamese. Write new Markdown documents in English, as requested in the current AGENTS instructions.
- Existing work belongs to multiple sessions/models. Do not attribute every dirty file to this feature or revert unrelated edits.

## What is present in the current source

| Area | Files | Observed implementation |
| --- | --- | --- |
| Metadata resolver | `worker/src/game-metadata.ts` (untracked) | Steam appdetails categories; IGDB game modes/multiplayer metadata; Twitch client-credentials authentication; canonicalization of numeric and `s_` Steam keys; cached D1 results; request deduplication; bounded provider calls. |
| Database | `worker/migrations/0002_game_classification.sql` (untracked), `worker/schema.sql` | `game_metadata` table with classification, source, confidence, evidence JSON, timestamps, and a classification index. |
| Ranking API | `worker/src/routes/community.ts`, around lines 1030-1121 | `GET /api/community/rankings` accepts `classification=all|online|hybrid|offline|unknown`; returns classification/source/confidence. Admin refresh and manual override routes are present. |
| Background context | `worker/src/index.ts`, `worker/src/types.ts` | Request context passes `executionCtx`; types include optional Twitch credentials. These files already contain this integration at the inspected HEAD and are not listed as modified. |
| Shared DTO | `src/shared/community.ts` | `GameRanking` includes classification and optional source/confidence. |
| Ranking frontend | `src/renderer/community/CommunityHub.tsx`, around lines 383-419 and 1289-1306 | Existing sort controls cover hours, score, completions, and players. `loadRankings()` sends sort/query/offset only. Classification state, controls, and request parameter are missing in this component. |
| Score ranking | `worker/src/routes/community.ts` | The SQL requires `reviewCount >= 1` when `sort=score`; the other sorts can include unreviewed catalog games. Existing tests cover early reviews and database catalog entries. |
| Review synchronization | `src/main/cloud-db.ts`, `worker/src/routes/community.ts` | Local review synchronization and `/api/community/me/reviews/sync` exist. Current desktop edits include migration acknowledgement and sync optimizations. These are not a fresh authenticated production verification. |
| Activity history | `worker/src/routes/community.ts`, `tests/community.test.js` | `/api/community/me/comments` and tests for personal, paginated comment history exist. Profile post/review loading is present in `CommunityHub.tsx`; verify the actual UI against the user's history requirements. |

### Existing metadata behavior and limits

- Classifications are `online`, `hybrid`, `offline`, and `unknown`.
- Steam resolution calls `https://store.steampowered.com/api/appdetails` with the app ID. IGDB is the fallback when Steam metadata is unavailable or inconclusive, and is the provider used for non-Steam titles.
- IGDB requires existing `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` Worker bindings. Their current production presence/validity was not checked. Never copy secret values into this document.
- IGDB tries a Steam external-game link when available, otherwise a normalized exact title/alternative-name match. Missing or ambiguous matches remain unknown.
- Known results expire after 30 days; unknown results retry after one day. Manual classifications are protected. A failed upstream refresh does not overwrite a known classification with unknown.
- `GET /rankings` schedules at most two stale/missing catalog entries through `executionCtx.waitUntil`. This is request-triggered and incremental. A large catalog will not be classified immediately, and this resolver does not establish a scheduled backfill.
- Admin routes are `POST /api/community/admin/game-metadata/refresh` and `PUT /api/community/admin/game-metadata/:gameKey` with a classification body. The refresh endpoint currently processes at most two entries per request.
- Provider mode flags describe single-player/multiplayer capabilities; they do not perfectly identify a competitive live-service game. Review the intended grouping and current heuristic before claiming all requested examples are correctly classified. In particular, `classifySteam()` currently maps category 38 (online co-op) to `offline` when competitive flags are absent. This behavior needs a deliberate product rule and tests.
- Game recognition in a running Windows process is a separate concern from catalog classification. No claim is made here that process detection for League/Valorant or every launcher was changed or validated.

## Remaining work, in order

1. Inspect the existing Top Games component and CSS, then add compact classification controls using its existing style and colors. Support all four stored classifications plus an All option; choose clear Vietnamese labels that match the actual heuristic.
2. Add classification state to `CommunityHub.tsx`, include it in the ranking request and effect dependencies, and reset pagination on changes. Retain the existing sequence guard so a stale request cannot overwrite a newer filter. Apply the same classification parameter when loading more.
3. Show an understandable state for unknown/unclassified games. Missing provider credentials or metadata must not silently label a game offline. Ensure the user can still find unclassified games.
4. Add focused metadata tests with mocked providers: Steam categories, IGDB-only games, hybrid games, ambiguous title matches, missing credentials, upstream errors, TTL refresh, manual overrides, key aliases, and preservation of known classifications during outages. Add ranking tests for each classification filter, invalid values, score eligibility within each filter, and pagination. Existing tests below do not cover this new resolver.
5. Decide how to populate the existing catalog without requiring many manual page visits. Keep provider rate limits and Worker execution limits in view; test that ranking responses do not wait for the backfill.
6. Inspect the live migration history before applying SQL. There are currently two files beginning with `0002`: `0002_completed_at.sql` and the new `0002_game_classification.sql`. Resolve the naming/history situation before deployment. Tests initialize from `worker/schema.sql`; their success does not prove an existing remote database has `game_metadata`.
7. Build and verify the current desktop/community frontend. Check filter interactions, pagination, empty states, and red theme in the actual UI. No visual browser verification was performed during this handoff.
8. Deploy only after the implementation and appropriate checks are complete, using the existing Worker/database and preserving bindings. Confirm the live metadata table and provider configuration before exposing the new SQL/API. Verify the real user's score/review sync through the normal app flow; do not seed fake production activity.

## Fresh verification performed for this handoff

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed, exit 0. |
| `node node_modules/typescript/bin/tsc -p worker/tsconfig.json --noEmit` | Passed, exit 0. |
| Electron Node-mode test run of `tests/community.test.js` and `tests/library-sync.test.js` | **40 tests passed, 0 failed, 0 skipped; 3 suites.** TAP output captured through Node `spawnSync`. |
| `git diff --check` | Passed; only a Git LF/CRLF notice for `src/renderer/components/AuthBadge.tsx`. |
| Metadata-specific tests | No references to `game-metadata`, `classification`, `classifySteam`, or `classifyIgdb` were found under `tests/` in the inspected checkout. No new tests were added in this handoff. |
| Current production state, provider HTTP requests, migration application, full build, full test suite, browser UI | Not verified in this handoff. |

The successful test invocation used the installed Electron runtime via Node to ensure the process was awaited and TAP output was captured. A direct PowerShell invocation of `electron.exe` returned no captured output, so it was not used as proof that tests passed.

```powershell
node -e 'const {spawnSync}=require("node:child_process"); const r=spawnSync(process.cwd()+"/node_modules/electron/dist/electron.exe",["--test","--test-reporter=tap","tests/community.test.js","tests/library-sync.test.js"],{env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},encoding:"utf8"});process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");if(r.error)process.stderr.write(String(r.error));process.exit(r.status??1);'
```

Use `rtk` when it is available, following the workspace instructions. It was unavailable during these diagnostics.

## Worktree preservation

The inspected worktree has 23 tracked modified files, plus untracked assets, profile/follow features, temporary UI artifacts, a status Worker, migrations, and the metadata module. The metadata feature cannot be isolated by treating the entire diff as its work.

- Tracked changes include `src/main/cloud-db.ts`; shared community types; `CommunityHub`, `CommunityWidgets`, `DesktopCommunity`, `GameHub`, `PlayerBoard`, community client/CSS; renderer App, Navbar, AuthBadge, SettingsModal, TimelineView, CommunityView; community Vite config; community/library-sync tests; Worker schema, common helpers, and community/discovery/library routes.
- Untracked work in the final status check includes `worker/src/game-metadata.ts`, `worker/migrations/0002_game_classification.sql`, `0005_public_profiles_and_images.sql`, `0006_user_follows.sql`, `worker/src/routes/follows.ts`, community search/follow/profile components and presets, `src/shared/profile-presets.ts`, `scripts/generate-profile-presets.mjs`, `public/`, and `status-worker/`. An earlier status snapshot listed temporary navigation/build files, but they were absent from the final status output; their disposition was not investigated.
- Preserve these files and check `git status` again before resuming. Do not delete temporary/untracked files merely because their purpose has not yet been established.

## Deployment context and historical notes

The existing `DEPLOYMENT_HANDOFF.md` begins with a completed deployment dated 2026-11-26 08:33:56 (Asia/Saigon). It names the original `game-vault-worker` and D1 database `game-vault-d1` (`2f252069-15b0-4957-a6d2-c31be05f7344`), with origin `https://game-vault-worker.gamevault-son.workers.dev`.

That file also retains older account/authentication blockers and an old three-review minimum. Those sections are historical; they must not override the current user's one-review rule or be repeated as a verified present-day blocker. The latest production deployment, installed migrations, and current account access require fresh read-only verification when deployment work resumes.

Build order in the existing deployment workflow is admin first, then community, because they share the static asset output directory. Inspect the current configs before executing the build/deployment workflow.

## Suggested continuation prompt

> Read HANDOFF_GAME_CLASSIFICATION.md and inspect the current worktree without reverting others' changes. Complete the API-driven Steam/non-Steam classification filters in Top Games using the existing red UI, add focused resolver/ranking tests, and verify the user flow. Preserve the one-review score-ranking rule and server review persistence. Verify existing migration history and production bindings before deploying to the current Worker/D1. Do not claim process detection or live-service classification is perfect. Communicate in Vietnamese and write new Markdown in English. No commit or push unless requested.
