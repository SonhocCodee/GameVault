# Push Sync Log (2-Machine Handoff)

File này lưu tóm tắt mỗi lượt đẩy code (`git push`) để đồng bộ ngữ cảnh giữa **2 máy làm việc**.
Quy tắc đi kèm được lưu tại `.agents/rules/push-sync-log.md`.

> **Quy ước:**
> - **Mục mới nhất luôn nằm trên cùng**, chèn ngay bên dưới thẻ `<!-- LATEST_FIRST -->`.
> - Đọc mục gần nhất sau khi `git pull` hoặc khi bắt đầu phiên làm việc mới.
> - Cập nhật file này và commit trước mỗi lần `git push`.

<details>
<summary>Mẫu entry (Template)</summary>

```markdown
## [YYYY-MM-DD HH:mm] — Máy: <HOSTNAME> — Branch: <branch>
- **Tóm tắt:** <Mô tả ngắn gọn lượt đẩy này đã làm những gì>
- **Thay đổi chính:**
  - `<file/path>`: <thay đổi gì>
- **Kiểm tra:** <đã chạy test/build gì, hoặc "Chưa chạy test/build">
- **Bàn giao / Tiếp theo:** <lưu ý cho máy kia nếu có>
```

</details>

---

<!-- LATEST_FIRST -->

## [2026-11-26 11:39] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Sửa triệt để lỗi không load được ảnh trong tab Cộng đồng Desktop (`community:baseUrl`), tách riêng Bảng tin kiểu Facebook (ẩn review tự động, đặt khung đăng bài lên đầu), sửa layout Podium Top 3 game không bị rớt dòng, lọc trùng bản ghi `t_*` trong Top game (Alan Wake 2), và thêm nút 1-click bật chia sẻ giờ chơi lên BXH.
- **Thay đổi chính:**
  - `src/main/main.ts`: Truyền `getCloudConfig()` vào `getWorkerBaseUrl(getCloudConfig())` trong IPC `community:baseUrl` (fix nguyên nhân mọi ảnh `/api/images/...` bị trỏ về `127.0.0.1:8787`).
  - `worker/src/routes/community.ts`: Hỗ trợ `?excludeKind=review` ở `GET /api/community/posts` và loại bỏ bản ghi `t_*` trùng tên với game có `steam_id` trong `GET /api/community/rankings`.
  - `src/renderer/community/CommunityHub.tsx`, `PostComposer.tsx`, `community.css`: Bảng tin kiểu Facebook (khung đăng bài nhanh ngay đầu + truyền `excludeKind=review` để review nằm riêng trong từng game), sửa CSS `.gv-podium-card` chống rớt chữ dọc, thêm banner 1-click **"Công khai giờ chơi lên BXH ngay"** trên Top game.
  - `tests/community.test.js`: Bổ sung test cho `excludeKind=review` và chống trùng `t_*` trong `/rankings`.
- **Kiểm tra:**
  - `npx tsc --noEmit -p worker/tsconfig.json`, `npm run build`, `npm run build:admin`, `npm run build:community`: Pass.
  - `npm test`: **478/478 tests pass** (`96 suites`, `0 fail`, `0 skipped`).
- **Bàn giao / Tiếp theo:** Thoát hẳn app GameVault ở System Tray (nếu đang mở) rồi mở lại để nạp bản build mới (ảnh sẽ load đầy đủ), sau đó bấm **Công khai giờ chơi lên BXH ngay** trên Top game (hoặc bật trong Hồ sơ) để `Crimson Desert` 220h và toàn bộ 59 game hiện đủ trên BXH.

## [2026-11-26 11:32] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Hoàn thiện đồng bộ Cloud 100% (bao gồm `completed_at` và từng phiên chơi `user_sessions`), đại tu toàn diện giao diện & UX tab Cộng đồng (`CommunityHub`, `GameHub`, `PostCard`, `PostComposer`, `PlayerBoard`, `GamePlayers`, `PerformancePanel`, `ScreenshotShare`, `MonthlyPick`), chạy migration D1 + deploy Cloudflare Worker & `/community/` lên production.
- **Thay đổi chính:**
  - `worker/migrations/0003_user_sessions.sql`, `worker/schema.sql`, `worker/src/routes/library.ts`, `worker/src/types.ts`, `src/shared/types.ts`, `src/main/cloud-db.ts`: Thêm bảng `user_sessions` trên D1, chuẩn hóa `clientUpdatedAt` sang UTC ISO-8601, đồng bộ 2 chiều các phiên chơi thực tế (`source != 'manual'`) và gộp bằng `recalculatePlaytime` để lịch sử giờ chơi theo tháng giống nhau 100% giữa các máy; bỏ `last_played_at` sai khi tạo game mới.
  - `worker/src/routes/community.ts`, `worker/src/routes/discovery.ts`, `src/shared/community.ts`: Lọc bài review rỗng khỏi Bảng tin công khai, bổ sung `avatarUrl`, `reviewScore`, `reviewDropped`, `playtimeMinutes` (chỉ trả về khi có giá trị).
  - `src/renderer/community/*`: Thiết kế lại toàn bộ giao diện & tính năng Cộng đồng đồng bộ theme tối GameVault (`community.css`, `CommunityWidgets.tsx` với `ConfirmModal`, `ReportModal`, `ImageLightbox`, `Avatar`, `KindBadge`); `PostComposer` có tìm game + ảnh cover + preview/kéo-thả tối đa 3 ảnh; `PostCard` có huy hiệu chủ đề, điểm đánh giá, timestamp bình luận; Top game có podium Top 3 + danh sách thẻ poster; `GameHub` chia tab `Cấu hình & FPS` (parse cấu hình Steam 2 cột + thống kê FPS trung bình/PresentMon + lọc GPU/độ phân giải/preset), `Đánh giá` (chọn điểm 1–10 trực quan), `Bài viết & Ảnh`, `Người chơi`.
  - `src/main/drive.ts`, `src/renderer/components/SettingsModal.tsx`: Định dạng dung lượng TB/GB và hiển thị thông tin Drive Quota gọn hơn.
  - `tests/library-sync.test.js`: Bổ sung test đồng bộ `user_sessions` và `completed_at` giữa 2 máy.
- **Kiểm tra:**
  - `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
  - `npm run build`, `npm run build:admin`, `npm run build:community`: Pass.
  - `npm test`: **477/477 tests pass** (`96 suites`, `0 fail`, `0 skipped`).
  - Cloudflare Production (`game-vault-worker` Version `f3548af2-5475-4fc0-9ca2-99ece3ffbb9a`, D1 `game-vault-d1`): Đã ghi nhận `0002_completed_at.sql`, áp dụng `0003_user_sessions.sql`, deploy Worker + `/community/` static assets; kiểm tra `/health`, `/community/`, `/api/community/rankings`, `/api/community/posts` đều trả HTTP 200.
- **Bàn giao / Tiếp theo:** Mở app GameVault trên máy còn giữ đủ `completed_at` & lịch sử session và bấm **Sync** để đẩy toàn bộ `user_sessions` + `completed_at` lên Cloud, sau đó bấm **Sync** trên máy kia để kéo đồng bộ về.

## [2026-11-26 11:18] — Máy: CNTT-PM6 — Branch: main
- **Tóm tắt:** Hoàn thiện và đẩy toàn bộ tính năng Cộng đồng (`/community/` web & Desktop), chia sẻ hiệu năng/cấu hình game, đồng bộ `completed_at` lên Cloud (`0002_completed_at.sql`), nhận diện game qua Discord Detectable (`discord-detectable.ts`), và cải thiện độ bền vững lưu trữ cover trên Worker.
- **Thay đổi chính:**
  - `community-web/`, `src/renderer/community/`, `src/shared/community.ts`, `src/renderer/components/CommunityView.tsx`, `Navbar.tsx`, `AuthBadge.tsx`, `GameDetail.tsx`, `App.tsx`: Xây dựng giao diện Cộng đồng cho cả Desktop và Web công khai (`/community/`), bài viết gắn game, ảnh nén, spoiler, thích/bình luận/lưu bài, bảng xếp hạng, khám phá game và báo cáo hiệu năng.
  - `worker/src/routes/community.ts`, `worker/src/routes/discovery.ts`, `worker/src/community-common.ts`, `worker/schema.sql`, `worker/migrations/0001_community.sql`, `worker/migrations/0002_completed_at.sql`: Thêm API cộng đồng, discovery/Steam requirements, đồng bộ `completed_at` (`library.ts`, `src/main/cloud-db.ts`), và siết kiểm tra cover persistence (`covers.ts`, `images.ts`, `reviews.ts`, `leaderboard.ts`, `users.ts`).
  - `src/main/discord-detectable.ts`, `src/main/game-settings.ts`, `src/main/performance-context.ts`, `src/main/tracker.ts`, `src/main/db.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`: Thêm nhận diện game từ danh sách Discord detectable, đọc cấu hình/hiệu năng máy & game.
  - `tests/`: Bổ sung `community.test.js`, `community-identity.test.js`, `game-settings.test.js`, `worker-cover-persistence.test.js` và cập nhật `cloud-db.test.js`, `library-sync.test.js`, `tracker.test.js`, `worker-backend.test.js`.
  - Tài liệu: `PRODUCT.md`, `DEPLOYMENT_HANDOFF.md`, `COMMUNITY_*.md`, `scripts/community-preview.js`, `wrangler.toml`, `package.json`, `.gitignore`.
- **Kiểm tra:**
  - `npm run build` (Electron main/preload + Vite renderer): Pass.
  - `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
  - `npm test`: **472/476 tests pass** (`96 suites`, `0 fail`, `4 skipped`).
  - `npm run build:community`: Thất bại do lỗi khóa file Windows `EPERM` khi xóa `worker/admin-assets/community/assets/index-BPwW_uM4.css`.
- **Bàn giao / Tiếp theo:** `0001_community.sql` và Worker đã được deploy lên production trước đó; lưu ý kiểm tra/chạy migration `0002_completed_at.sql` lên D1 (`game-vault-d1`) và deploy Worker mới nhất để đồng bộ `completed_at` lên Cloud.

## [2026-11-26 10:57] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Thiết kế lại tab **Tất cả** trong thư viện: hàng đầu giữ **Game chơi gần đây**, phân cách rõ với phần dưới hiển thị **Tất cả game** dạng lưới đầy đủ kèm ô tìm kiếm, lọc trạng thái và sắp xếp (mặc định A - Z).
- **Thay đổi chính:**
  - `src/renderer/App.tsx`: Thêm `allSearchQuery`, `allStatusSubFilter`, `allSortBy` (`title_asc` mặc định, `title_desc`, `playtime_desc`, `recent_played`, `rating_desc`), `filteredAllGames`, vạch phân cách "Toàn bộ thư viện" và lưới `GameCard` đầy đủ cho toàn bộ game.
- **Kiểm tra:**
  - `npm run build`: Build Electron main/preload và Vite thành công.
  - `npm test`: **405/405 tests pass** (`93 suites`, `0 fail`).
- **Bàn giao / Tiếp theo:** Nếu app đang chạy ngầm ở System Tray trên máy `DESKTOP-BU4IIOC`, thoát hẳn rồi mở lại để dùng bản build mới.

## [2026-11-26 10:53] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Sửa tab "Theo dõi thời gian chơi" không còn dính các game chỉ chỉnh giờ thủ công (`manual` audit rows như Dark Souls III, Armored Core VI, Baldur's Gate 3, Forza Horizon 5, The Witcher 3, Ghost of Tsushima, Dead Space -1500m) vào Tháng 11, tính gộp khoảng thời gian (interval union) theo tháng để chống đếm trùng giữa `tracker` / `amd_import` / `ptwatch`, và bổ sung chống cộng giờ khi máy sleep/hibernate trong `PlaytimeTracker`.
- **Thay đổi chính:**
  - `src/renderer/components/TimelineView.tsx`: Bỏ qua các bản ghi `source === 'manual'` trong tab "Theo dõi thời gian chơi" và dùng `computeUnionMinutes` (interval union) thay vì cộng dồn thô `duration_minutes`.
  - `src/main/db.ts`: Loại trừ `source = 'manual'` khỏi truy vấn `last_played_at` trong `getGames()` để việc chỉnh giờ thủ công không làm sai ngày chơi gần nhất.
  - `src/main/tracker.ts`: Theo dõi `lastPollTime` trên `activeSession` và thêm `SLEEP_GAP_MS` (120s) trong `pollOnce()` để tự đóng session tại `lastPollTime + 30s` khi máy sleep/hibernate thay vì cộng cả thời gian ngủ vào giờ chơi.
  - `tests/tracker.test.js`, `tests/db.test.js`: Bổ sung test `pollOnce` sleep/hibernate gap và `getGames` `last_played_at` bỏ qua `manual`.
- **Kiểm tra:**
  - `npm test`: **405/405 tests pass** (`93 suites`, `0 fail`).
  - `npm run build`: Build Electron main/preload và Vite thành công.
- **Bàn giao / Tiếp theo:** Nếu app GameVault đang mở/chạy ngầm ở System Tray trên máy `DESKTOP-BU4IIOC`, cần thoát hẳn rồi mở lại để dùng bản build mới. Máy kia khi `git pull` vẫn cần ghép với bản sửa đồng bộ `completed_at` nếu chưa push.

## [2026-11-26 10:41] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Sửa fallback ngày trong `TimelineView.tsx` để game phá đảo hoặc thiếu session không bị nhảy nhầm sang tháng tạo DB (`created_at`), đồng thời phát sự kiện `game:updated` khi kết thúc phiên chơi trong `main.ts`.
- **Thay đổi chính:**
  - `src/renderer/components/TimelineView.tsx`: Gỡ fallback `created_at` ở tab "Tất cả game" và nhánh game chưa có session; với tab game phá đảo chỉ dùng `game.completed_at` thay vì fallback sang `last_played_at`.
  - `src/main/main.ts`: Gửi IPC `game:updated` về renderer trong `tracker.onSessionClosed` khi session hợp lệ (`!result.discarded && result.gameId`).
- **Kiểm tra:**
  - `npm test`: **403/403 tests pass** (`93 suites`, `0 fail`).
  - `npm run build`: Build Electron main/preload và Vite thành công.
- **Bàn giao / Tiếp theo:** Máy kia đang có bản sửa đồng bộ `completed_at` trên Cloud (`0002_completed_at.sql`, `library.ts`, `cloud-db.ts`, `TimelineView.tsx`, `library-sync.test.js`) chưa đẩy lên remote — khi máy kia `git pull` cần chú ý ghép `TimelineView.tsx`, sau đó migrate D1, deploy Worker, rồi mở app trên máy `DESKTOP-BU4IIOC` bấm Sync để đẩy toàn bộ `completed_at` lên Cloud.

## [2026-11-25 10:43] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Chặn triệt để ảnh ngang (landscape) vào slot Poster 2:3 từ gốc ở cả Worker & Desktop, tự động fallback IGDB (Twitch), và nâng cấp bộ lọc nhận diện game chống nhận nhầm IDE / Electron app (`Antigravity-x64`, `Cursor`, `Windsurf`, v.v.).
- **Thay đổi chính:**
  - `worker/src/routes/covers.ts`: Thêm `getImageDimensions` / `isLandscapeBytes` đọc header PNG/JPEG/WebP; `ingestExternalImage(..., { rejectLandscape: true })`, `handleCacheCover`, và `handleAdminBatchIngest` tự động từ chối ảnh ngang (`library_hero.jpg`, `header.jpg`, hoặc `width > height`) cho slot Poster và tự fallback sang IGDB (Twitch).
  - `src/main/covers.ts`: Gỡ fallback `art.bannerUrl` vào `posterUrl` trong `resolveWebCoversForGame` để không nhét ảnh ngang vào poster.
  - `src/main/tracker.ts`, `src/main/importer.ts`, `src/main/cloud-db.ts`, `resources/playtime-watch.ps1`: Thêm `isNonGameAppDirectory`, `hasElectronOrDesktopAppFingerprint` (chặn app có `resources/app.asar` hoặc `chrome_elf.dll` + `v8_context_snapshot.bin` không có SDK game), `NON_GAME_TITLE_REGEX`, chặn `antigravity*`, `cursor*`, `windsurf*`, `mremoteng*`, `putty*` ở cả tracker, AMD importer, ptwatch và cloud sync.
  - `tests/tracker.test.js`, `tests/cloud-covers.test.js`: Bổ sung test chặn IDE/Electron app và test từ chối ảnh ngang 16:9 vào slot Poster.
- **Kiểm tra:**
  - `npm run build` & `npm run deploy:worker`: Pass (Worker Version `c9bacad3-23d1-404f-8086-9aa6a22d8d76`).
  - `npm test`: **403/403 tests pass** (`93 suites`, `0 fail`).
  - Production D1: Đã xóa `t_antigravityx64` khỏi `user_library`, tự động sửa 3 poster ngang cuối (`2584270`, `3280350`, `4115450` → `528x704` portrait) qua `batch-ingest` & `sync-all` (`60/60` poster đều chuẩn dọc).
- **Bàn giao / Tiếp theo:** Trên máy đang chạy app, cần thoát hẳn tiến trình app cũ đang chạy ngầm ở System Tray rồi mở lại app mới build để `syncLibraryWithCloud()` dùng code mới kéo ảnh Cloud về.

## [2026-11-25 10:29] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Xây dựng Web Quản trị (`/admin`) phục vụ qua Cloudflare Workers Static Assets, nâng cấp đồng bộ cover toàn server D1, tích hợp IGDB (Twitch) trên Worker và đồng bộ toàn bộ 60/60 game lên Cloud.
- **Thay đổi chính:**
  - `admin-web/`: Tạo SPA Web Admin (`App.tsx`, `LoginView.tsx`, `CoverEditorPanel.tsx`, `api.ts`, `vite.config.ts`) hỗ trợ tìm kiếm nhanh, lọc trạng thái, Quét từ Server DB, Check ảnh lỗi (chunk 15 game/request), Auto-Ingest, tra cứu IGDB, kéo-thả/upload ảnh và Sync Toàn Server.
  - `worker/src/routes/covers.ts`, `worker/src/routes/library.ts`, `worker/src/index.ts`, `worker/src/auth.ts`, `worker/src/types.ts`, `worker/src/utils.ts`: Thêm `propagateCoverAcrossTables` đồng bộ `game_covers` sang `user_library`, `ratings`, `community_picks`, `community_votes`; auto-discover game từ DB trong `GET /api/admin/covers`; thêm `/api/admin/me`, `/api/admin/config`, `/api/admin/covers/:gameKey/upload`, `/api/admin/covers/discover`, `/api/admin/covers/igdb-search`, `/api/admin/covers/health-check`, `/api/admin/covers/batch-ingest`, `/api/admin/covers/sync-all`; ưu tiên Master Cover trong `handleGetLibrary`/`handleSyncLibrary`; serve `/admin` qua `env.ASSETS` và hỗ trợ `WEB_GOOGLE_CLIENT_ID` + `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`.
  - `src/main/cloud-db.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/components/AuthBadge.tsx`, `src/shared/types.ts`: Cho phép `syncLibraryWithCloud()` ghi đè ảnh local lỗi/cũ khi có Master Cover hoặc `/api/images/...`; sửa `admin:uploadCover` gọi `/api/admin/covers/:gameKey/upload` + fix MIME `.png`; thêm nút **Mở Web Admin (`/admin`)** trong `AuthBadge`.
  - `wrangler.toml`, `package.json`, `.gitignore`: Cấu hình `[assets]` (`worker/admin-assets`, `run_worker_first = true`), thêm scripts `build:admin`, `dev:admin`, `deploy:worker`.
  - `tests/cloud-covers.test.js`: Bổ sung test `3.8`, `3.9` kiểm tra propagation toàn bảng, client sync overwrite, discover/health-check/batch-ingest/admin assets.
- **Kiểm tra:**
  - `npm run build` & `npm run build:admin`: Pass.
  - `npm test`: **401/401 tests pass** (`93 suites`, `0 fail`).
  - Cloudflare Production: Đã migrate `worker/schema.sql` lên D1 `game-vault-d1`, nạp secrets `TWITCH_CLIENT_ID` & `TWITCH_CLIENT_SECRET`, deploy Worker (Version `8f135fe7-6c38-4cc3-8cd5-cb88da2ed372`), và chạy sync toàn bộ `60/60` game (`128` ảnh trên Cloud, `healthy: 60`, `missing: 0`, `broken: 0`, `external: 0`, `user_library` đã sync `72` dòng).
- **Bàn giao / Tiếp theo:** Nếu muốn bấm nút Google Sign-In trực tiếp trên trình duyệt tại `/admin/` (thay vì mở qua App Desktop), tạo thêm OAuth Client loại *Web application* trên Google Cloud Console và thêm vào `WEB_GOOGLE_CLIENT_ID` trong `wrangler.toml`, rồi chạy `npm run deploy:worker`.

## [2026-11-25 08:35] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Thiết lập quy trình đồng bộ lịch sử push code và rule tự động cho AI khi làm việc trên 2 máy.
- **Thay đổi chính:**
  - `PUSH_LOG.md`: Tạo file nhật ký tóm tắt mỗi lượt đẩy code (mới nhất ở trên cùng).
  - `.agents/rules/push-sync-log.md`: Tạo workspace rule (`always_on`) nhắc AI đọc `PUSH_LOG.md` khi pull/bắt đầu phiên, bắt buộc cập nhật `PUSH_LOG.md` trước khi `git push`, và tự tạo global rule trên máy còn lại nếu chưa có.
  - Global rule trên máy `DESKTOP-BU4IIOC` (`~/.gemini/config/rules/push-sync-log.md`): Đã được thêm đồng bộ.
- **Kiểm tra:** Đã kiểm tra `git status` và nội dung các file rule theo đúng chuẩn Antigravity (`trigger: always_on`). Không sửa code app nên không chạy build.
- **Bàn giao / Tiếp theo:** Khi máy kia `git pull` về, AI bên máy kia sẽ tự động đọc `.agents/rules/push-sync-log.md` và tạo global rule tương ứng tại `~/.gemini/config/rules/push-sync-log.md`. (Commit nền trước đó trên repo: `345b127`).
