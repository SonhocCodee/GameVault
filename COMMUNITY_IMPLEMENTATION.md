# Community and Game Performance Implementation

## Current production status — 2026-11-26

The community Worker and public web are deployed on the existing GameVault origin: https://game-vault-worker.gamevault-son.workers.dev/community/. Earlier statements that deployment is blocked or pending are historical.

- Verified the correct Cloudflare owner `son623200@gmail.com` and exact existing Worker/D1 binding before writes. Account: `56aee61715618184fb5702ec502aa333`.
- Applied additive migration `0001_community.sql`, verified 14 tables/eight indexes, and recorded the migration in Wrangler-compatible history at `2026-11-26 01:32:06` UTC. Core counts remain `users=2`, `user_library=93`, `ratings=0`, `image_store=131` before/after migration and deployment.
- Fresh Electron, renderer, admin, and community builds and Worker dry-run passed. Published six assets and bundle SHA-256 `fc8f0897779dcceb44e995db4b98efb869119b0905ac87f978110c42b9f5041f` (160491 bytes).
- Active deployment `bb382b62-0b0d-45f3-9665-cbc178877a1d`; version `47f1561d-08a7-466a-8029-aa632521f1e6` at 100%, created `2026-11-26T01:33:56.572555Z`. Previous version `c9bacad3-23d1-404f-8086-9aa6a22d8d76` is the rollback reference. Existing origin, D1, Google/session/Twitch bindings, and compatibility settings were preserved through strict binding inheritance.
- Production HTTP checks passed for health, feed, rankings, public web, admin, four JS/CSS resources, game search, numeric-key Steam requirements, and performance listing. Browser checks passed for anonymous browsing, search, game navigation, actual Steam requirements, and empty states, with no observed console errors in the checked flow. Screenshot: `.impeccable/review/community-production.jpg`.
- No synthetic community content was published. Discovery checks used ordinary public reads and the normal application Steam cache. Authenticated end-user mutations were not tested in production.
- Optional web Google sign-in still needs `WEB_GOOGLE_CLIENT_ID` for the deployed web origin; it is currently absent. Anonymous web reading is available. Existing desktop Google/Drive configuration was preserved without credential changes.
- No source functionality changes, commit, or push were made during deployment. Historical full-suite results remain as recorded; fresh validation covered deployment builds and production read-only behavior.

## Authority and reading policy

This English document is the implementation authority for this task. Do not open, ingest, search, or quote `COMMUNITY_IDEAS.md`, `COMMUNITY_V2_IDEAS.vi.md`, or any other Vietnamese idea document while implementing. They are write-only user deliverables. User-facing UI remains Vietnamese with explicit UTF-8 handling.

## Confirmed requirements

- Launch the community publicly, not as an invitation-only group.
- Implement a usable first release: game-linked posts and selected screenshots, likes, comments, public game hubs with reviews, public profiles, explicit sharing preferences, aggregate game rankings, reporting/blocking/moderation, and notifications.
- Readers can browse without signing in. Posting and interaction require the existing Google authentication.
- Provide shareable public web routes as well as the desktop community screen.
- Add a Discover experience to search games, inspect Steam minimum/recommended requirements, and compare completed players' hardware, average FPS, resolution, and graphics settings.
- Assess automatic export of game settings across a large catalog. Implement an extensible, conservative adapter system and a generic explicitly configured file export; do not claim universal discovery or silently export arbitrary files.
- Preserve current uncommitted Discord game detection changes and existing local library/cloud/save workflows.

## Product truth

Electron hosts a React/TypeScript/Tailwind UI. Main/preload IPC bridges local SQLite and OS integrations. Cloudflare Workers/D1 owns public metadata and community API. Existing Google OAuth supplies authentication. Private Drive media/save backups must not be publicized by community operations.

## Experience

Community uses Feed, Discover, and Profile navigation. Discover exposes a game search followed by a game hub: official Steam requirements; completed-player performance reports; reviews; posts. Post links and game/profile links work in a responsive public web reader. Existing monthly picks remain accessible.

The established dark interface, red brand accent, sky community accent, typography, and controls are inherited. No unrelated redesign. Unknown measurements remain unknown, and loading, empty, permission, validation, upload, and offline states are visible.

## Data and trust rules

1. Add dedicated public profile, public shared library, posts, post images, likes, comments, saved posts, notifications, blocks, reports, moderation restrictions, performance reports, and bounded rate-limit tables. Existing private `user_library` is not queried for public profiles or rankings.
2. Explicit public-library sharing copies only a whitelist of game fields, never notes, file paths, executables, backups, tokens, or email. Withdrawal removes shared stats from rankings and profiles. Posts/reviews remain independently managed.
3. Public names cannot fall back to email. Existing identity fields are projected through a public-safe DTO. Public API never exposes email.
4. Public rankings count distinct consenting user/game records. Aggregate hours count each user/game once. Score ranking requires at least three distinct public reviews. Publish lifetime totals only; do not fabricate weekly/monthly usage from cumulative hours.
5. Posts support text, one game, kind, spoiler flag, and at most three selected compressed JPEG/PNG/WebP images. Upload ownership is checked before attachment. Separate community image URLs check visibility on every request and use non-immutable cache policy. Orphan uploads have bounded quotas and cleanup. Delete/hide removes image access.
6. Mutations require authentication and ownership checks. Limits apply on the server, including numeric finite bounds, JSON body size, image bytes/signatures, pagination, action frequency, duplicate likes/reports, and comment length. Reports can target posts, comments, reviews, and performance reports. Admin actions can hide content or restrict a user. Blocking affects content reads and notifications.
7. Preserve one public review per user/game. New community review input is bounded, spoiler-aware, and does not auto-publish private notes. Public game hubs exist before their first review.
8. Completed-player performance reports require an explicit completed status, confirmed graphics context, and a hardware snapshot. PresentMon measurements are tied to their own session/hardware/context, not relabeled with today's GPU or mixed across graphics settings. Self-reported metrics are distinguished from measured metrics. Completion is user-reported, not a verified achievement.
9. Resolution means in-game output resolution confirmed or read from supported configuration; monitor size is not evidence of game resolution. Missing resolution/preset/FPS is shown as unavailable and cannot be presented as a complete benchmark.
10. FPS averages combine compatible measurements by total sample frames / total measured frame duration (harmonic weighting when only per-session average/sample count is available). Do not use a plain average or average reports from unrelated systems. Show sample count, source, date, rendering preset, upscaling/frame generation when supplied, and a comparability disclaimer.

## Game discovery and Steam

- Search the public catalog and Steam store search through a bounded, cached Worker endpoint. Fetch app details by validated numeric app ID, with timeout and upstream failure states.
- Preserve Steam minimum/recommended requirement text while stripping HTML to safe text. Render no arbitrary upstream HTML. Show the Steam source link and retrieval date. Missing recommended requirements are explicitly unavailable.
- Non-Steam games can still have community pages; do not invent Steam requirements or attach a guessed app ID.
- Performance reports are filtered by GPU, resolution, and graphics preset. Each row is one user's own shared hardware/context, not a generic guarantee.

## Local performance and settings export

- Persist a game graphics context and collect a session-specific hardware/context snapshot alongside new FPS sessions. Offer a local preview before sharing.
- Expose local IPC for reading/updating context, selecting a measured session, preparing a completed-game report, detecting supported config files, choosing a config file explicitly, and exporting a ZIP/settings manifest to a user-selected destination.
- Automatic detection uses allowlisted per-game adapters with bounded paths and filenames. Start with well-understood INI/XML/JSON formats, including supported Unreal configuration candidates, and a documented example game adapter. Generic support uses the user-selected config file; unsupported games say unsupported.
- Export is local and read-only at the source. Do not recursively sweep user folders, include save files, copy credentials, invoke game executables, import settings automatically, or upload raw configuration through public reports.
- Adapter parsing extracts only safe graphics fields for public reports. Raw config export warns that a local archive can include identifying settings; the user chooses the files and destination. Limit file types and bytes, reject symlinks/outside configured roots, and protect against traversal/colliding archive names.
- Universal automatic export is not feasible without a maintained adapter catalog: games use different paths/formats, registry/binary settings, cloud saves, launchers, and version-dependent layouts. This release makes coverage explicit and provides a manual fallback.

## Work sequence and verification

- [x] Add public community schema, shared DTOs, validation, and Worker routes.
- [x] Add public search/Steam requirements and completed-player report routes.
- [x] Add local graphics/session snapshots and conservative settings export adapters/IPC.
- [x] Connect desktop Feed/Discover/Profile and selected screenshot sharing; preserve monthly picks and reviews.
- [x] Add responsive public community web routes, Google sign-in, sharing, and administrator report controls.
- [x] Validate meaningful integration cases: public/private separation, authorization, limits, image lifecycle, duplicate interaction, ranking correctness, completed-only report and snapshot provenance, Steam missing/failure cases, settings export bounds, and existing regressions.
- [x] Run Electron/renderer/public-web/admin builds, TypeScript checks, full test suite, UTF-8 validation on changed frontend files, and a bounded visual/interaction review. Initial results are recorded below; deployment builds and production browsing were rechecked on 2026-11-26.

## Deployment

Source changes and local artifacts are authorized. Prepare a D1 migration and build outputs. Do not modify production data or deploy without a concrete reviewable result and applicable user authorization. Report any environment-dependent step accurately; local tests are not production verification.

## Progress

Planning authority created; implementation in progress. Validation results and remaining environment requirements will be recorded here in English.

## User steering during implementation

- Prioritize community functionality; defer aesthetic UI polishing to the user.
- Desktop sign-in belongs exclusively to the existing top-right navbar. Community uses the same shell AuthStatus and never creates a separate desktop OAuth flow. A missing or unavailable community endpoint must not turn a signed-in shell into an anonymous state.
- Remove duplicate desktop authentication chrome as a functional correction; preserve public-web sign-in.

## Deployment authorization

The user approved opening Cloudflare sign-in and deploying the reviewed Worker/web plus the D1 community migration. Existing Google/Drive sign-in must remain unchanged. From this point, user-facing questions must be in English; progress and results remain Vietnamese. Cloudflare CLI authentication is separate from end-user Google authentication.

## Verified implementation status

- Community source implementation is complete. Aesthetic UI polishing is explicitly deferred to the user. Desktop authentication uses the existing navbar AuthStatus; community endpoint failures no longer produce a separate desktop sign-in flow.
- Full suite: 460 tests, 456 passed, 4 skipped, 0 failed. Root, Worker, and public-web TypeScript checks passed. All four builds passed. UTF-8 validation passed for 21 frontend files. Worker dry-run passed. D1 local schema and versioned migration passed.
- Functional review found and resolved four issues: restriction persistence on public-profile deletion, moderation of review feed entries, immutable graphics/hardware FPS sessions during legacy churn repair, and credential-bearing XML export rejection. New regressions pass.
- Production is not deployed yet. The public community endpoint returned HTTP404 before deployment. The user approved migration and Worker/web deployment.
- Wrangler sign-in was unsuccessful; the user explicitly requested installing and using Cloudflare MCP instead. Official endpoint: https://mcp.cloudflare.com/mcp. Global server cloudflare-api was added through the existing Codex CLI; OAuth completed successfully. Existing MCP settings and credential storage were preserved.
- The current executor still reports unknown MCP server cloudflare-api. User has been asked (in English) to restart that server in Codex Settings. Once available, use its search/execute tools to inspect the exact existing Worker game-vault-worker and D1 database game-vault-d1 (database ID in wrangler.toml), apply worker/migrations/0001_community.sql, deploy the reviewed build and public assets, and verify public endpoints read-only. Never publish synthetic preview posts/benchmarks to production.
- Cloudflare MCP authentication is unrelated to and must not replace existing Google/Drive sign-in in GameVault. Public web Google sign-in requires the optional WEB_GOOGLE_CLIENT_ID; desktop sign-in and anonymous web reading do not.
- Do not read any Vietnamese idea file while continuing. Questions to the user must be English; progress/results remain Vietnamese. No goal was created. No git commit or push was performed. Preserve existing uncommitted Discord detector edits.

## Final handoff status

Cloudflare MCP is now loaded and authenticated. Deployment is blocked by resource ownership: the authorized account 7b7f41e24c4ae11a418a9629fe7fd636 lists only Worker muddy-paper-5770, and both the configured GameVault Worker and D1 UUID return HTTP404. A D1 name-filtered list also returned zero matches. No production writes were performed. The user requested a handoff for another session if deployment could not proceed; DEPLOYMENT_HANDOFF.md contains the full resume instructions. Reconnect to the account that owns the exact existing targets before migration/deployment.

## Resume verification — 2026-11-25 17:23:44 (Asia/Saigon)

- Rechecked the authenticated Cloudflare account list: only `7b7f41e24c4ae11a418a9629fe7fd636` is accessible. It still lists only Worker `muddy-paper-5770`. The exact GameVault Worker settings endpoint returns HTTP 404 / error 10007, and the exact D1 UUID endpoint returns HTTP 404 / error 7404.
- Public baseline: `/health` and `/admin/` return HTTP 200; `/api/community/posts`, `/api/community/rankings`, and `/community/` return HTTP 404.
- Rebuilt Electron, desktop renderer, admin web, and community web successfully from the current worktree, with admin built before community. Invoked the existing build tools directly through Node because npm script execution failed in this host; no source changes were needed.
- Fresh Wrangler dry-run succeeded: 156.73 KiB upload / 33.71 KiB gzip. Current bundle: `.impeccable/review/worker-build-current/index.js`, 160491 bytes, SHA-256 `fc8f0897779dcceb44e995db4b98efb869119b0905ac87f978110c42b9f5041f`.
- Static asset inventory contains six files, including both admin and community entry HTML files. The reviewed additive migration contains 14 `CREATE TABLE IF NOT EXISTS` statements and eight `CREATE INDEX IF NOT EXISTS` statements (including the unique index).
- Started `codex mcp login cloudflare-api` using the installed bundled CLI. OAuth is waiting for the user to sign in to the Cloudflare account that owns the existing targets. Verify the accessible account and exact Worker/D1 again after authentication; a CLI OAuth completion by itself is not resource-ownership verification.
- No remote migration, Worker deployment, production data writes, git commit, or push were performed. Existing source edits were preserved. The previous test-suite results were not rerun in this resume; the checks above are fresh build/deployment-preparation checks.

## Resume verification — 2026-11-26 08:19 (Asia/Saigon)

- Fresh Electron, desktop renderer, admin, and community builds passed. Fresh Worker dry-run passed; bundle SHA-256 remains `fc8f0897779dcceb44e995db4b98efb869119b0905ac87f978110c42b9f5041f` (160491 bytes). Both admin and community entry HTML files are present among six deployment assets.
- Cloudflare MCP still authorizes only the account listing Worker `muddy-paper-5770`. Exact GameVault Worker and D1 checks return HTTP 404 (errors 10007 and 7404). All accessible account-list pages were covered.
- Public `/health` and `/admin/` return HTTP 200; community posts, rankings, and web routes remain HTTP 404. Deployment is still pending, not complete.
- A new Cloudflare MCP OAuth flow was started; the user must authorize the account owning the existing targets. Reverify ownership before applying the additive migration and publishing the prepared artifacts.
- No source functionality changes, production writes, migration, deployment, commit, or push occurred. Full-suite results above are historical; this resume performed fresh builds, dry-run, and read-only deployment checks.

### OAuth completion follow-up — 2026-11-26

- Latest: the user completed OAuth after the authorization screen showed the correct owner `son623200@gmail.com`. CLI login succeeded. Live MCP `whoami` still returns the previous `son62320@gmail.com` identity; account discovery still exposes only the old account. The connection needs to be restarted in Codex Settings > MCP servers before rechecking the exact targets. No MCP-restart tool is available in this chat; no production mutation was attempted.

- The user subsequently confirmed the ownership mismatch: GameVault belongs to `son623200@gmail.com`; the mistakenly selected account was `son62320@gmail.com`. Started a new MCP OAuth flow to authorize the correct owner. Verify both exact production resources after completion. No resources were created or deployed in the wrong account by this work.

- User completed OAuth and the CLI confirmed successful MCP login. Subsequent live MCP checks still expose only the previous account and Worker `muddy-paper-5770`; exact GameVault Worker/D1 access still fails with HTTP 404.
- Deployment remains pending. Requested confirmation of target visibility in the selected account's Cloudflare Dashboard before diagnosing account ownership versus a retained MCP connection. No production mutation was attempted.
