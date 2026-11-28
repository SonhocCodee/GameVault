# Push Sync Log (2-Machine Handoff)

File này lưu tóm tắt mỗi lượt đẩy code (`git push`) để đồng bộ ngữ cảnh giữa **2 máy làm việc**.
Quy tắc đi kèm được lưu tại `.agents/rules/push-sync-log.md`.

> **Quy ước:**
> - **Mục mới nhất luôn nằm trên cùng**, chèn ngay bên dưới thẻ `<!-- LATEST_FIRST -->

## [2026-11-28 17:04] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Phát hành `v1.0.13` — Sửa hover `GameRowSection` & đồng bộ UI 2 tab `TimelineView`**:
  - Cập nhật `src/renderer/components/GameRowSection.tsx`: tăng `pt-2.5 -mt-1.5 px-1.5` ở khung cuộn ngang (`overflow-x-auto`) để hiệu ứng `hover:-translate-y-1.5` của `GameCard` không bị cắt phần đỉnh.
  - Cập nhật `src/renderer/components/TimelineView.tsx`: đồng bộ cùng tông đỏ `#ff2a44` cho cả 2 tab `Đã phá đảo` / `Tất cả game` và badge tiêu đề, đồng thời giữ cố định thanh `Năm` (hiển thị `—` khi trống) để thanh điều hướng không bị xô lệch khi đổi tab.
  - Tăng `version` lên `1.0.13` trong `package.json`, thêm changelog `1.0.13` trong `src/shared/changelog.ts` và làm sạch `PENDING_PUSH.md`.

### File chính đã thay đổi
- `src/renderer/components/GameRowSection.tsx`, `src/renderer/components/TimelineView.tsx`
- `package.json`, `src/shared/changelog.ts`, `PENDING_PUSH.md`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`, `npx tsc --noEmit -p worker/tsconfig.json`, `npm run build`, `npm test` (chạy trước khi push `v1.0.13`).

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions `.github/workflows/release.yml` sẽ tự build và phát hành bản `v1.0.13`.

## [2026-11-28 16:47] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Phát hành `v1.0.12` — Quét ngày chơi cuối (`last_played_at`) & đồng bộ giao diện Dòng thời gian**:
  - Thêm cột `games.last_played_at` trong `src/main/db.ts` (`COALESCE(MAX(session.start_time), games.last_played_at)`) để các game quét từ máy hiển thị đúng tháng/năm chơi gần nhất thay vì rơi vào nhóm `2020 về trước`.
  - Cập nhật `src/main/local-game-scanner.ts` đọc thêm mốc ngày chơi/cập nhật cuối: Steam `localconfig.vdf` (`LastPlayed`) → `appmanifest_*.acf` (`LastUpdated`), GOG `GameTimes.lastPlayedDate`, AMD `RGStats.db` `GameSessions`, và fallback `mtimeMs` của file `.exe` / thư mục game (Epic, Riot, Xbox, Windows).
  - Làm lại header `src/renderer/components/TimelineView.tsx`: bỏ dòng chú thích dài dưới tiêu đề, đồng bộ bố cục giữa Thư viện và Hồ sơ Cộng đồng, nâng cấp thanh chọn `Năm` thành bộ lọc pill gọn gàng (`Tất cả`, `2026`, `≤ 2020`, ...).
  - Bổ sung kiểm tra `lastPlayedAt` / `last_played_at` trong `tests/local-game-scanner.test.js`, tăng `version` lên `1.0.12` trong `package.json` và thêm changelog `1.0.12` trong `src/shared/changelog.ts`.

### File chính đã thay đổi
- `src/main/db.ts`, `src/main/local-game-scanner.ts`, `src/renderer/components/TimelineView.tsx`
- `tests/local-game-scanner.test.js`, `package.json`, `src/shared/changelog.ts`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `566/570` (`0` fail, `4` skipped).

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions `.github/workflows/release.yml` sẽ tự build và phát hành bản `v1.0.12`. Người dùng chỉ cần bấm lại `Quét game trên máy` để cập nhật `last_played_at` cho các game đã quét trước đó.

## [2026-11-28 16:38] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Phát hành `v1.0.11` — Tự động quét game trên máy, gợi ý Top game & sửa badge Dòng thời gian**:
  - Thêm bộ quét đa nguồn không phụ thuộc GPU (`src/main/local-game-scanner.ts`): Steam (`libraryfolders.vdf`, `appmanifest_*.acf`, `localconfig.vdf` `Playtime`), Epic Games (`*.item`), GOG Galaxy (`galaxy-2.0.db` + `GameTimes`), Riot Games (`RiotClientInstalls.json`), Xbox (`MicrosoftGame.Config`), AMD Adrenalin (`RGStats.db` + `gmdb.blb` read-only) và Windows `GameConfigStore` (chỉ nhận `.exe` đã xác thực). Giờ chơi cũ nạp vào giờ cá nhân (`recorded_playtime_minutes = 0`), tôn trọng `deleted_games` và guest isolation.
  - Thêm IPC `games:scanLocal`, tùy chọn quét sẵn ở Bước 2 `FirstRunSetupModal.tsx`, nút `Quét game trên máy` ở màn hình thư viện trống, thanh công cụ `Tất cả game`, modal `+ Thêm game` (`AddGameModal.tsx`) và menu `Công cụ` (`Navbar.tsx`), cùng nút `Gợi ý game (Top game)` nối thẳng tới tab `Top game` (`CommunityHub.tsx`).
  - Sửa đè badge trạng thái & badge giờ chơi dài (4 chữ số) trên thẻ game ở `TimelineView.tsx` bằng flex layout, `formatCompactPlaytime`, badge `9.5px` và lưới `lg:grid-cols-6 xl:grid-cols-7` vừa gọn chiều cao vừa không bị cắt `...`.
  - Tăng `version` lên `1.0.11` trong `package.json`, thêm nhật ký `1.0.11` trong `src/shared/changelog.ts`, làm sạch `PENDING_PUSH.md`.

### File chính đã thay đổi
- `src/main/local-game-scanner.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`, `src/shared/changelog.ts`
- `src/renderer/App.tsx`, `src/renderer/components/AddGameModal.tsx`, `src/renderer/components/FirstRunSetupModal.tsx`, `src/renderer/components/Navbar.tsx`, `src/renderer/components/TimelineView.tsx`
- `src/renderer/components/CommunityView.tsx`, `src/renderer/community/DesktopCommunity.tsx`, `src/renderer/community/CommunityHub.tsx`
- `tests/local-game-scanner.test.js`, `package.json`, `PENDING_PUSH.md`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `566/570` (`0` fail, `4` skipped).

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions `.github/workflows/release.yml` sẽ tự build và phát hành bản `v1.0.11` cho auto-update.

## [2026-11-28 15:03] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Làm gọn giao diện `GraphicsConfigBlock.tsx`**:
  - Mặc định ẩn danh sách pill chi tiết, chỉ hiển thị nút **Xem thông số (N)** + khung **File setting gốc** (`fileName`, `folderHint`, `Tải file`, `Copy đường dẫn`, `Mở thư mục`, `Áp dụng vào máy`).
  - Khi bấm **Xem thông số (N)** sẽ mở bảng lưới 2 cột có thanh cuộn thay vì rải pill tràn màn hình.
  - Đã build lại `community-web` & deploy Worker (`c0733e81-0d49-4dae-a95b-07d3ff1afcc2`).

### File chính đã thay đổi
- `src/renderer/community/GraphicsConfigBlock.tsx`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`, `npm run build`, `npm run deploy:worker`: Pass.

## [2026-11-28 14:56] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Full setting đồ họa, phiên bản game, tải/import file setting gốc & hướng dẫn thư mục**:
  - Nâng cấp `parseGraphicsConfig` (`src/main/game-settings.ts`): trích xuất toàn bộ key đồ họa/hiển thị an toàn (tối đa 80 mục), lọc bỏ credential/keybind/đường dẫn cá nhân.
  - Bổ sung `getGameExecutableVersion` (đọc ProductVersion/FileVersion từ `.exe` trên Windows), `collectSharedConfigFiles` (đính kèm tối đa 2 file setting gốc <= 64 KB đã khử đường dẫn user thành `%LOCALAPPDATA%` / `%APPDATA%` / `%USERPROFILE%` / `<Thư mục cài game>`), `openConfigFolderHint` & `importSharedConfigFile` (backup `.bak` trước khi ghi đè).
  - Cập nhật `src/shared/community.ts`, `src/shared/types.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/main/performance-context.ts`, `src/main/cloud-db.ts` (signature `'v3'`), và `worker/src/routes/discovery.ts` để lưu & validate `gameVersion`, `details` (80 mục) và `configFiles`.
  - Tạo `src/renderer/community/GraphicsConfigBlock.tsx` và tích hợp vào `src/renderer/community/GameHub.tsx`: hiển thị badge phiên bản game, nút **Xem tất cả (N)** / **Thu gọn**, và mục **File setting gốc & Hướng dẫn thư mục** (Tải file, Copy đường dẫn, Mở thư mục, Áp dụng vào máy).
  - Bổ sung unit test trong `tests/game-settings.test.js`, deploy Worker (`d731fd09-9d83-4491-89d5-3e0d18532a32`), và chạy sync toàn bộ (`SYNC_RESULT: {"synced":39}`).

### File chính đã thay đổi
- `src/main/game-settings.ts`, `src/main/performance-context.ts`, `src/main/cloud-db.ts`, `src/main/main.ts`, `src/preload/preload.ts`
- `src/shared/community.ts`, `src/shared/types.ts`
- `src/renderer/community/GraphicsConfigBlock.tsx`, `src/renderer/community/GameHub.tsx`
- `worker/src/routes/discovery.ts`, `tests/game-settings.test.js`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `563/563` (103 suites, 0 fail, 0 skipped).
- `npx wrangler deploy`: Pass (`d731fd09-9d83-4491-89d5-3e0d18532a32`).
- Electron sync (`son6232000@gmail.com`): Pass (`SYNC_RESULT: {"synced":39}`).

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về và chạy `npm run build` để có UI mới (`GraphicsConfigBlock.tsx`) trên máy kia.

## [2026-11-28 14:49] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Nới rate limit upload báo cáo FPS trên Worker & hoàn tất đồng bộ dữ liệu máy `son6232000@gmail.com`**:
  - Cập nhật `worker/src/routes/discovery.ts`: nâng `rateLimit(env, user.uid, "performance", ...)` từ `5` lên `50` báo cáo / 300s.
  - Đã deploy `worker/` (`game-vault-worker`, Version ID `a584e330-bedc-4cbc-882f-d959b556e019`).
  - Đã chạy đồng bộ trực tiếp toàn bộ phiên FPS hợp lệ trên máy hiện tại lên Worker (`SYNC_RESULT: {"synced":5}` lượt đầu + `{"synced":2}` lượt hai).

### File chính đã thay đổi
- `worker/src/routes/discovery.ts`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx wrangler deploy`: Pass (`a584e330-bedc-4cbc-882f-d959b556e019`).
- Electron performance sync (`son6232000@gmail.com`): Pass (`0` lỗi).

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về để đồng bộ `worker/src/routes/discovery.ts`.

## [2026-11-28 14:43] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Bổ sung file bị thiếu khi commit trước đó**: `git add src/main/community-notifications.ts` (file mới được import bởi `src/main/main.ts:30`).

### File chính đã thay đổi
- `src/main/community-notifications.ts`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit` & `npm run build` đã pass với file này trên `CNTT-PM6`.

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về và chạy `npm run build` lại là được.

## [2026-11-28 14:30] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Hoàn thiện chia sẻ & hiển thị chi tiết setting đồ họa (`graphics.details`) trên Community Hub & phát hành `v1.0.10`**:
  - Bổ sung hiển thị `r.graphics.details` (tối đa 12 mục) trong danh sách báo cáo cộng đồng ở tab **Cấu hình & Hiệu năng (`specs`)** của `src/renderer/community/GameHub.tsx`.
  - Bump prefix `'v2'` trong `computePerformanceSignature` (`src/main/cloud-db.ts`) để các máy đã sync lên Worker cũ tự động re-upload đầy đủ `graphics.details` lên Worker mới.
  - Đã deploy `worker/` (`npm run deploy:worker`, Version ID `5ba2dd75-6cac-4996-8b66-41727cbac959`).
  - Gộp các thay đổi đang có trên máy (`admin-web` `CoverEditorPanel` + `ImageCropModal`, `worker` covers/community/discovery, `tracker.ts`, `MonthlyRankings.tsx`, `game-identity.ts`, `tests/community.test.js`), cập nhật `src/shared/changelog.ts` & bump `package.json` lên `1.0.10`.

### File chính đã thay đổi
- `src/renderer/community/GameHub.tsx`, `src/main/cloud-db.ts`, `src/shared/changelog.ts`, `package.json`
- `admin-web/src/components/CoverEditorPanel.tsx`, `admin-web/src/components/ImageCropModal.tsx`
- `worker/src/index.ts`, `worker/src/routes/community.ts`, `worker/src/routes/covers.ts`, `worker/src/routes/discovery.ts`
- `src/main/tracker.ts`, `src/renderer/community/MonthlyRankings.tsx`, `src/renderer/community/community.css`, `src/shared/game-identity.ts`, `tests/community.test.js`
- `PENDING_PUSH.md`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`, `npx tsc --noEmit -p worker/tsconfig.json`, `npm run build`, `npm test` (chạy trước khi push).

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về; mở app trên máy có nick `son6232000@gmail.com` để `v2` signature tự re-upload `graphics.details` lên Worker mới.

## [2026-11-28 11:17] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Đảm bảo auto-sync FPS lấy đủ setting chi tiết & tự re-upload lên Cộng đồng**:
  - Cập nhật `buildAutoCommunityPerformanceReport` (`src/main/performance-context.ts`): gộp `preview.context.details`, `preset`, `upscaling`, `frameGeneration`, `rayTracing` vào báo cáo ngay cả khi session cũ đã có `width`/`height`.
  - Cập nhật `syncLocalPerformanceToCommunity` & `computePerformanceSignature` (`src/main/cloud-db.ts`): tự động gọi `discoverGameConfigsAsync(gameId)` trước khi build báo cáo và hash thêm `upscaling`, `frameGeneration`, `rayTracing`, `details` để tự động re-upload khi phát hiện setting mới.

### File chính đã thay đổi
- `src/main/performance-context.ts`, `src/main/cloud-db.ts`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `561/561` (103 suites, 0 fail, 0 skipped).

### Bàn giao cho máy kia (Notes / Next)
- Cần deploy `worker/` (`wrangler deploy`) lên Cloudflare Worker để endpoint `/api/community/games/:gameKey/performance` trên server live lưu trường `graphics.details`.

## [2026-11-28 11:14] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Tự động nhận diện file setting game (Save-dir + PCGamingWiki API) & hiển thị chi tiết setting đồ họa**:
  - Cập nhật `src/main/game-settings.ts`:
    - Bổ sung `scanSaveRelatedConfigs` quét tự động file cấu hình (`.ini`/`.cfg`/`.json`/`.xml`/`.settings`) trong thư mục save và thư mục anh em (`Config`/`Settings`) + thư mục cài đặt game, lọc credential qua `hasCredentialSettings`.
    - Bổ sung `discoverGameConfigsAsync` & `extractPcgwConfigPathsFromWikitext` tra cứu tự động đường dẫn file config trên PCGamingWiki API (cache 7 ngày trong `app_settings`).
    - Nâng cấp `parseGraphicsConfig` thành generic parser hỗ trợ INI/CFG/JSON/XML: trích xuất thêm `upscaling` (DLSS/FSR/FSR 3/XeSS), `frameGeneration`, `rayTracing` và `details` (Window Mode, VSync, FPS Cap, Textures, Shadows, AA, Effects, Post Processing, View Distance, Foliage, Reflections, AO, Volumetric Fog, Anisotropic, Motion Blur, Render Scale, FOV, HDR).
  - Expose IPC `gameSettings:discover` trong `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`.
  - Mở rộng `GraphicsContext.details` trong `src/shared/community.ts`, `src/main/performance-context.ts`, và `worker/src/routes/discovery.ts` (`validatePerformanceReport`).
  - Cập nhật `src/renderer/community/PerformancePanel.tsx` & `src/renderer/community/GameHub.tsx`: tự động chạy `discoverGameConfigs`, hiển thị chi tiết setting đọc được lên UI cá nhân và Cộng đồng, kèm nút **Chọn file setting...** dự phòng.
  - Bổ sung 3 unit test mới trong `tests/game-settings.test.js`.

### File chính đã thay đổi
- `src/main/game-settings.ts`, `src/main/performance-context.ts`, `src/main/main.ts`
- `src/preload/preload.ts`, `src/shared/community.ts`, `src/shared/types.ts`
- `src/renderer/community/PerformancePanel.tsx`, `src/renderer/community/GameHub.tsx`
- `worker/src/routes/discovery.ts`, `tests/game-settings.test.js`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `561/561` (103 suites, 0 fail, 0 skipped).

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về; nếu test thực tế với Cloudflare Worker thì cần deploy `worker/` để server nhận/lưu trường `graphics.details` mới (các trường cũ vẫn tương thích ngược).

## [2026-11-28 10:55] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Tự động nhận diện & khóa chỉnh sửa thủ công cấu hình máy + FPS theo máy đang đăng nhập**:
  - Cập nhật `src/renderer/components/AuthBadge.tsx`: bỏ toàn bộ ô nhập tay GPU/CPU/RAM và nút lưu thủ công; hiển thị chỉ đọc thông số phần cứng thực tế từ `getHardwareInfo()` (Card GPU + VRAM, CPU + nhân/luồng, RAM, Màn hình `width×height @ Hz`, OS) kèm nút **Tự nhận diện** để quét lại & đồng bộ lên cloud.
  - Thêm `syncCurrentMachineHardwareProfile` trong `src/main/cloud-db.ts` (expose qua `community:syncMyHardwareProfile` trong `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`), tự động chạy khi đăng nhập (`changeAccount`) và khi mở app đã đăng nhập (`app.whenReady()`), đảm bảo đổi máy đăng nhập sẽ tự nhận đúng cấu hình máy đó.
  - Cập nhật `src/renderer/components/CommunityView.tsx` & `submitReview` (`src/main/cloud-db.ts`): bỏ ô nhập tay FPS khi viết review, tự động lấy `fps_avg` đo được trên máy hiện tại (chỉ đọc).
- **Đồng bộ các thay đổi đang có trên `DESKTOP-BU4IIOC`**:
  - Bao gồm cập nhật auto-share performance (`PerformancePanel.tsx`, xóa `PerformanceShareForm.tsx`), AMD watcher/importer FPS, `SaveVaultSection.tsx`, `GameDetail.tsx`, `GameCard.tsx`, và `worker/src/routes/discovery.ts`.

### File chính đã thay đổi
- `src/renderer/components/AuthBadge.tsx`, `src/renderer/components/CommunityView.tsx`
- `src/main/cloud-db.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`
- Cùng các file đang sửa trên máy (`src/main/amd-watcher.ts`, `src/main/importer.ts`, `src/main/performance-context.ts`, `src/renderer/community/*`, `src/renderer/components/SaveVaultSection.tsx`, `worker/src/routes/discovery.ts`, `tests/amd-watcher.test.js`, `tests/game-settings.test.js`)
- `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass `558/558` (103 suites, 0 fail, 0 skipped).

### Bàn giao cho máy kia (Notes / Next)
- Pull `main` về và chạy `npm install` nếu có thay đổi `package-lock.json`.

## [2026-11-27 17:34] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Fix lỗi thiếu `latest.yml` trên GitHub Releases (`v1.0.6` bị 404 khi auto-update)**:
  - Cập nhật `.github/workflows/release.yml` để luôn chạy `gh release upload "v$version" "release/latest.yml" --clobber` trước khi mở draft (`gh release edit --draft=false`).
  - Cập nhật `src/shared/changelog.ts` thêm `1.0.8` và bump `package.json` lên `1.0.8`.

### File chính đã thay đổi
- `.github/workflows/release.yml`, `package.json`, `src/shared/changelog.ts`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- Phát hiện từ GitHub Releases API: `v1.0.6` thiếu asset `latest.yml` (trong khi `v1.0.5` có). Đã bổ sung bước upload `release/latest.yml` trực tiếp trong workflow.

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions sẽ tự động build & publish `v1.0.8` kèm `latest.yml`.

## [2026-11-27 17:31] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Thêm mục Báo lỗi (Bug Report) trực tiếp trong app & Admin Web**:
  - Thêm D1 migration `worker/migrations/0012_bug_reports.sql` và route `worker/src/routes/bugs.ts` (`/api/bugs`, `/api/admin/bugs`, `/api/admin/bugs/:id`) có xác thực, rate-limit và index D1.
  - Thêm `src/main/bugs.ts` tự động đính kèm `gamevault.log` và thông tin OS/GPU khi người dùng gửi báo lỗi.
  - Thêm `src/renderer/components/BugAndUpdateModal.tsx` (tab **Báo lỗi (Bug)** với form gửi lỗi & danh sách theo dõi trạng thái `Mới` / `Đang sửa` / `Đã fix`) và tích hợp nút **Báo lỗi** vào `Navbar.tsx` & `App.tsx`.
  - Thêm `admin-web/src/components/BugReportsPanel.tsx` (tab **Báo lỗi (Bugs)** trong Admin Web) để đọc log đính kèm, cập nhật trạng thái, gắn phiên bản đã fix và viết ghi chú phản hồi.
- **Thêm mục Cập nhật & Nhật ký thay đổi (Changelog / Post-Update What's New)**:
  - Thêm `src/shared/changelog.ts` (`CHANGELOG_ENTRIES`) và cập nhật `src/main/updater.ts` (theo dõi `last_seen_version` trong SQLite, trích xuất `releaseNotes` từ `electron-updater` và fetch GitHub Releases).
  - Tự động bật tab **Cập nhật & Đã fix gì** khi người dùng vừa cập nhật lên phiên bản mới, kèm nút **Đã fix gì?** trên banner auto-update.
- **Bump version `1.0.7` & Deploy Worker/D1**:
  - Đã chạy `npx wrangler d1 migrations apply game-vault-d1 --remote` (`0012_bug_reports.sql`) và `npm run deploy:worker`.
  - Tăng `version` trong `package.json` lên `1.0.7` để GitHub Actions `.github/workflows/release.yml` tự động build & phát hành bản cài đặt Windows.

### File chính đã thay đổi
- `worker/migrations/0012_bug_reports.sql`, `worker/src/routes/bugs.ts`, `worker/src/index.ts`
- `src/shared/types.ts`, `src/shared/changelog.ts`
- `src/main/bugs.ts`, `src/main/updater.ts`, `src/main/main.ts`, `src/preload/preload.ts`
- `src/renderer/components/BugAndUpdateModal.tsx`, `src/renderer/components/Navbar.tsx`, `src/renderer/App.tsx`
- `admin-web/src/components/BugReportsPanel.tsx`, `admin-web/src/api.ts`, `admin-web/src/App.tsx`
- `package.json`, `PUSH_LOG.md`, `PENDING_PUSH.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build` & `npm run build:admin`: Pass.
- `npm test`: Pass `545/549` (4 skipped, 0 failed).
- `npx wrangler d1 migrations apply game-vault-d1 --remote` & `npm run deploy:worker`: Thành công.

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions `.github/workflows/release.yml` sẽ tự động build & publish bản `v1.0.7` lên GitHub Releases sau khi push `main`.

## [2026-11-27 16:39] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Chống trùng lặp (x2 game trong DB) giữa thêm thủ công, Wishlist và Auto-detect**:
  - Thêm `findMatchingGame` và `mergeGameMetadata` trong `src/main/db.ts`, tích hợp vào `db:createGame` (`src/main/main.ts`) để đối chiếu theo `exe_name`, `steam_id`, `title` (NOCASE) và `normalizeForMatch(title)`, tự gộp metadata còn thiếu thay vì tạo bản ghi thứ 2.
  - Cập nhật `autoRegisterNewGame` trong `src/main/tracker.ts` để nhận diện `steam_id` sớm và đối chiếu cả theo `steam_id` lẫn tên chuẩn hóa trước khi tạo game mới.
  - Cập nhật `addWishlistGame` trong `src/main/wishlist.ts` dùng `findMatchingGame`.
- **Gộp chọn trạng thái ban đầu vào `AddGameModal.tsx`**:
  - Cho phép chọn trực tiếp 1 trong 5 trạng thái (`Đang chơi`, `Wishlist (Chờ chơi)`, `Đã phá đảo`, `Tạm dừng`, `Bỏ dở`), kèm đánh giá & ghi chú tùy chọn khi chọn `Đã phá đảo`.
- **Tối ưu tốc độ tìm kiếm Steam (`covers.ts`, `AddGameModal.tsx`)**:
  - Thêm `appCatalogMemoryCache` (cache trong RAM) và fast-path trong `searchSteamApps` để trả kết quả ngay (~0–5ms) từ catalog local mà không bị chặn 4–8s bởi các provider mạng; giảm debounce gõ phím xuống `150ms`.
- **Bump version `1.0.5`**:
  - Cập nhật `package.json` lên `1.0.5` để `.github/workflows/release.yml` tự động build & publish bản cài đặt Windows lên GitHub Releases.

### File chính đã thay đổi
- `src/main/db.ts`, `src/main/main.ts`, `src/main/tracker.ts`, `src/main/wishlist.ts`, `src/main/covers.ts`
- `src/renderer/components/AddGameModal.tsx`
- `tests/db.test.js`, `tests/tracker.test.js`, `package.json`, `PUSH_LOG.md`

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.
- `node --experimental-strip-types --test tests/db.test.js tests/tracker.test.js`: Pass.
- `node --experimental-strip-types --test tests/wishlist.test.js tests/cloud-covers.test.js`: Pass (29/29).

### Bàn giao cho máy kia (Notes / Next)
- GitHub Actions workflow `.github/workflows/release.yml` sẽ tự động build & publish bản cài đặt `v1.0.5` lên GitHub Releases sau khi push `main`.
- Lưu ý: trên máy `CNTT-PM6` còn một số file sửa dở trước đó (`community-web/`, `status-worker/`, `worker/`, `SettingsModal.tsx`, `SyncModal.tsx`) chưa được commit trong lượt này.

## [2026-11-27 15:47] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Nâng cấp modal thêm game (`AddGameModal.tsx`)**:
  - Tách riêng `src/renderer/components/AddGameModal.tsx`, reset toàn bộ state & timer mỗi khi đóng/mở và bỏ `autoFocus` trực tiếp để tránh kẹt focus trên Electron Windows.
  - Tích hợp tìm kiếm trực tiếp qua Steam API (`searchWishlistGames`) và resolve cover/banner + `steam_id` trước khi gọi `createGame` (tránh race condition `updateGame` ngầm khi xóa game nhanh).
  - Thêm nút **"Chọn file .exe"** (`game:browseExe` IPC trong `src/main/main.ts` & `src/preload/preload.ts`) dùng `extractTitleFromExe` + `detectSteamAppIdCached` để tự nhận diện đúng tên game, `steam_id`, `exe_name` và `exe_path` từ file `.exe`.
- **Bump version `1.0.2`**:
  - Cập nhật `package.json` lên `1.0.2`.

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.

### Bàn giao / Tiếp theo cho máy kia
- Tạo tag `v1.0.2` (hoặc push tag `v1.0.2`) để GitHub Actions workflow `.github/workflows/release.yml` build & phát hành bản cài đặt Windows mới.

## [2026-11-27 14:24] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Fix treo/kẹt bấm sau khi xóa game & trên máy NVIDIA**:
  - Thêm `src/renderer/components/ConfirmModal.tsx` thay toàn bộ `window.confirm()` trong `App.tsx`, `GameDetail.tsx`, `SyncModal.tsx` (tránh lỗi kẹt focus/compositor của Chromium trên Electron Windows).
  - Reset sạch state modal `Thêm trò chơi mới` và bỏ `backdrop-blur-md` / `required` native trong `App.tsx`.
  - Chuyển `FpsMonitor.startCapture` (`src/main/fps-monitor.ts`) sang `async` (`execFile` + `setTimeout`), bỏ `spawnSync` + `Atomics.wait` chặn main thread.
  - Thêm listener `render-process-gone` và `child-process-gone` trong `src/main/main.ts`.
- **Hệ thống Log local + gửi log về Cloudflare Worker**:
  - Thêm `src/main/logger.ts` ghi `gamevault.log`, migration `worker/migrations/0010_client_logs.sql`, route `worker/src/routes/logs.ts` (`POST /api/logs`, `GET /api/admin/logs`), và nút **"Gửi log lỗi"** / **"Mở log"** trong `SettingsModal.tsx`.
- **Deploy Worker & Đóng gói `v1.0.1`**:
  - Đã chạy `0010_client_logs.sql` lên D1 remote (`game-vault-d1`) và `npm run deploy:worker`.
  - Tăng version `package.json` lên `1.0.1` và đóng gói sạch `GameVault/release/`.

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass (544 tests: 540 pass, 0 fail, 4 skipped).
- `npm run pack:win`: Pass (`GameVault-Setup-1.0.1.exe`, `GameVault-Web-Setup-1.0.1.exe`, `GameVault-Portable-1.0.1.exe`).

### Bàn giao / Tiếp theo cho máy kia
- Tạo GitHub Release `v1.0.1` trên `SonhocCodee/GameVault` và đính kèm `latest.yml`, `GameVault-Setup-1.0.1.exe`, `GameVault-Setup-1.0.1.exe.blockmap` để máy cài bản Setup tự động cập nhật.`

## [2026-11-26 19:34] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Security Hardening & Clean Packaging**:
  - Thêm `src/main/secure-storage.ts`, `.agents/rules/security-hardening.md`, `.agents/rules/release-packaging.md`.
  - Cập nhật `scripts/build.js`, `scripts/ensure-config.js`, `wrangler.toml`, `worker/src/auth.ts`, `src/main/auth.ts`, `src/main/settings.ts`, `src/main/main.ts` để mã hóa secret local, khóa quyền Worker và đóng gói sạch.
- **Public Profiles, Images, Follows & Community**:
  - Thêm `worker/migrations/0005_public_profiles_and_images.sql`, `0006_user_follows.sql`, `worker/src/routes/follows.ts`, `worker/src/routes/images.ts`.
  - Thêm `CommunitySearch.tsx`, `FollowButton.tsx`, `ProfileEditor.tsx`, `profile-presets.ts`, `scripts/generate-profile-presets.mjs`, `public/`.
- **Game Classification & Playtime Provenance**:
  - Thêm `worker/migrations/0007_game_classification.sql`, `0008_playtime_provenance.sql`, `worker/src/game-metadata.ts`, `HANDOFF_GAME_CLASSIFICATION.md`.
  - Cập nhật `src/main/tracker.ts`, `src/main/db.ts`, `src/main/cloud-db.ts`, `src/main/covers.ts`, `src/main/wishlist.ts` và các component UI liên quan.
- **Status Worker & Tests**:
  - Thêm `status-worker/` và các bộ test mới: `tests/security.test.js`, `tests/game-metadata.test.js`, `tests/playtime-provenance.test.js`, `tests/playtime-provenance-local.test.js`.

### Kiểm tra (Verify)
- Chưa chạy lại build/test trong lượt đẩy này (được yêu cầu push trực tiếp).

### Bàn giao / Tiếp theo cho máy kia
- Sau khi `git pull`, chạy `npm run build` và `npm test` trong `GameVault/` để xác nhận đồng bộ.
- Kiểm tra `HANDOFF_GAME_CLASSIFICATION.md` và các migration mới (`0005`–`0008`) nếu cần chạy trên D1 remote.`.
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

## [2026-11-27 16:18] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Đẩy game đang chạy lên giao diện ngay lập tức (`src/main/main.ts`, `src/renderer/App.tsx`)**:
  - Trong `tracker.onSessionStarted`, gửi ngay `game:updated` cho `mainWindow` khi phát hiện `.exe` game bắt đầu chạy (không còn đợi tới lúc thoát game `onSessionClosed` mới đẩy).
  - Trong `App.tsx`, `onGameUpdated` thực hiện upsert (thêm mới nếu chưa có trong `games`, cập nhật nếu đã có) và đồng bộ `getTrackerStatus()` ngay lập tức để game hiện lên mục **"Game chơi gần đây"** kèm huy hiệu **Đang chơi**.
- **Bump version `1.0.4`** (tự động build & release qua `.github/workflows/release.yml` trên nhánh `main`).

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.

### Bàn giao / Tiếp theo cho máy kia
- Kiểm tra release `v1.0.4` trên GitHub Releases.

## [2026-11-27 16:15] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Tách workflow CI (`dev`/`test`) và Auto-Release (`main` prod)**:
  - Thêm `.github/workflows/ci.yml` chạy `tsc`, `build`, `npm test` trên nhánh `dev`, `test` và Pull Request vào `main`.
  - Cập nhật `.github/workflows/release.yml` tự động build & publish bản cài đặt Windows lên GitHub Releases mỗi khi push lên `main` hoặc tag `v*` (tránh bị chặn bởi test `monthly-rankings.test.js` ngoài luồng desktop).

### Kiểm tra (Verify)
- Đã push `main` và tag `v1.0.3` để GitHub Actions tự publish bản `1.0.3`.

### Bàn giao / Tiếp theo cho máy kia
- Khi code/test thử nghiệm thì push lên nhánh `dev` (hoặc `test`); khi chốt phát hành cho người dùng thì bump `version` trong `package.json` và merge/push vào `main`.

## [2026-11-27 16:06] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Cấu hình `releaseType: "release"` trong `package.json`**:
  - Đảm bảo `electron-builder --win --publish always` phát hành bản chính thức (không bị giữ ở trạng thái Draft) để `electron-updater` nhận diện và tự động tải về cho người dùng.

### Kiểm tra (Verify)
- Re-push tag `v1.0.3` để GitHub Actions build & publish bản `1.0.3`.

### Bàn giao / Tiếp theo cho máy kia
- Chờ workflow `v1.0.3` hoàn tất trên GitHub Actions.

## [2026-11-27 16:02] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Auto-update kiểu Discord (`src/main/updater.ts`, `src/renderer/App.tsx`)**:
  - Kiểm tra cập nhật sau khi mở app `1.5s` và định kỳ mỗi `30 phút` (thay vì 4 giờ), giữ `autoDownload = true` và `autoInstallOnAppQuit = true`.
  - Hiển thị banner tiến trình tải bản cập nhật ngay trên giao diện chính (available / downloading % / downloaded → nút **Cập nhật & Khởi động lại**).
- **Bump version `1.0.3`**.

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npm run build`: Pass.

### Bàn giao / Tiếp theo cho máy kia
- Đã push tag `v1.0.3` để GitHub Actions build & publish bản cài đặt Windows mới.

## [2026-11-27 16:01] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Sửa workflow `.github/workflows/release.yml`**:
  - Bỏ `working-directory: GameVault` và đổi `cache-dependency-path: package-lock.json` để khớp với root repository trên GitHub Actions (fix lỗi `Setup Node.js` trên tag `v1.0.2`).

### Kiểm tra (Verify)
- Đã cập nhật và re-push tag `v1.0.2` để GitHub Actions build & publish Windows installer.

### Bàn giao / Tiếp theo cho máy kia
- Kiểm tra GitHub Actions / GitHub Releases `v1.0.2` hoàn tất.

## [2026-11-27 14:24] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Fix treo/kẹt bấm sau khi xóa game & trên máy NVIDIA**:
  - Thêm `src/renderer/components/ConfirmModal.tsx` thay toàn bộ `window.confirm()` trong `App.tsx`, `GameDetail.tsx`, `SyncModal.tsx` (tránh lỗi kẹt focus/compositor của Chromium trên Electron Windows).
  - Reset sạch state modal `Thêm trò chơi mới` và bỏ `backdrop-blur-md` / `required` native trong `App.tsx`.
  - Chuyển `FpsMonitor.startCapture` (`src/main/fps-monitor.ts`) sang `async` (`execFile` + `setTimeout`), bỏ `spawnSync` + `Atomics.wait` chặn main thread.
  - Thêm listener `render-process-gone` và `child-process-gone` trong `src/main/main.ts`.
- **Hệ thống Log local + gửi log về Cloudflare Worker**:
  - Thêm `src/main/logger.ts` ghi `gamevault.log`, migration `worker/migrations/0010_client_logs.sql`, route `worker/src/routes/logs.ts` (`POST /api/logs`, `GET /api/admin/logs`), và nút **"Gửi log lỗi"** / **"Mở log"** trong `SettingsModal.tsx`.
- **Deploy Worker & Đóng gói `v1.0.1`**:
  - Đã chạy `0010_client_logs.sql` lên D1 remote (`game-vault-d1`) và `npm run deploy:worker`.
  - Tăng version `package.json` lên `1.0.1` và đóng gói sạch `GameVault/release/`.

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build`: Pass.
- `npm test`: Pass (544 tests: 540 pass, 0 fail, 4 skipped).
- `npm run pack:win`: Pass (`GameVault-Setup-1.0.1.exe`, `GameVault-Web-Setup-1.0.1.exe`, `GameVault-Portable-1.0.1.exe`).

### Bàn giao / Tiếp theo cho máy kia
- Tạo GitHub Release `v1.0.1` trên `SonhocCodee/GameVault` và đính kèm `latest.yml`, `GameVault-Setup-1.0.1.exe`, `GameVault-Setup-1.0.1.exe.blockmap` để máy cài bản Setup tự động cập nhật.

## [2026-11-27 10:15] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Bảng xếp hạng tháng (`MonthlyRankings`)**:
  - Thêm `MONTHLY_RANKINGS.md`, `worker/migrations/0009_monthly_rankings.sql`, `worker/src/monthly-rankings.ts`, `worker/src/ranking-eligibility.ts`, `src/shared/monthly.ts`, `src/renderer/community/MonthlyRankings.tsx`, `src/renderer/community/monthly.css`, `tests/monthly-rankings.test.js`.
  - Cập nhật `worker/schema.sql`, `worker/src/routes/community.ts`, `src/shared/community.ts`, `src/renderer/community/CommunityHub.tsx`, `src/renderer/community/DesktopCommunity.tsx`, `src/renderer/community/GameHub.tsx`, `scripts/community-preview.js`, `tests/community.test.js`.
- **Cô lập thư viện theo tài khoản (`Account Library Isolation`)**:
  - Thêm `src/main/account-library.ts` và `tests/account-library.test.js`.
  - Cập nhật `src/main/auth.ts`, `src/main/cloud-db.ts`, `src/main/main.ts`, `src/main/tracker.ts`, `src/main/importer.ts`, `src/main/ptwatch.ts`, `src/main/fps-monitor.ts`, `src/main/performance-context.ts`, `tests/auth.test.js`, `tests/library-sync.test.js`.
- **Dọn UI & gỡ `ImportModal`**:
  - Xóa `src/renderer/components/ImportModal.tsx`; cập nhật `src/preload/preload.ts`, `src/renderer/App.tsx`, `src/renderer/components/Navbar.tsx`, `src/shared/types.ts`, `tests/ui.test.js`.

### Kiểm tra (Verify)
- `npx tsc --noEmit`: Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm run build`: Pass (`scripts/build.js` + `vite build`).
- `npm test`: Pass (544 tests: 540 pass, 0 fail, 4 skipped).

### Bàn giao / Tiếp theo cho máy kia
- Sau khi `git pull`, chạy `npm run build` và `npm test` trong `GameVault/` để xác nhận đồng bộ.
- Khi deploy bảng xếp hạng tháng lên production, chạy migration `worker/migrations/0009_monthly_rankings.sql` trên D1 trước khi `npm run deploy:worker` (chi tiết trong `MONTHLY_RANKINGS.md`).

## [2026-11-26 19:34] — Máy: CNTT-PM6 — Branch: main

### Tóm tắt công việc
- **Security Hardening & Clean Packaging**:
  - Thêm `src/main/secure-storage.ts`, `.agents/rules/security-hardening.md`, `.agents/rules/release-packaging.md`.
  - Cập nhật `scripts/build.js`, `scripts/ensure-config.js`, `wrangler.toml`, `worker/src/auth.ts`, `src/main/auth.ts`, `src/main/settings.ts`, `src/main/main.ts` để mã hóa secret local, khóa quyền Worker và đóng gói sạch.
- **Public Profiles, Images, Follows & Community**:
  - Thêm `worker/migrations/0005_public_profiles_and_images.sql`, `0006_user_follows.sql`, `worker/src/routes/follows.ts`, `worker/src/routes/images.ts`.
  - Thêm `CommunitySearch.tsx`, `FollowButton.tsx`, `ProfileEditor.tsx`, `profile-presets.ts`, `scripts/generate-profile-presets.mjs`, `public/`.
- **Game Classification & Playtime Provenance**:
  - Thêm `worker/migrations/0007_game_classification.sql`, `0008_playtime_provenance.sql`, `worker/src/game-metadata.ts`, `HANDOFF_GAME_CLASSIFICATION.md`.
  - Cập nhật `src/main/tracker.ts`, `src/main/db.ts`, `src/main/cloud-db.ts`, `src/main/covers.ts`, `src/main/wishlist.ts` và các component UI liên quan.
- **Status Worker & Tests**:
  - Thêm `status-worker/` và các bộ test mới: `tests/security.test.js`, `tests/game-metadata.test.js`, `tests/playtime-provenance.test.js`, `tests/playtime-provenance-local.test.js`.

### Kiểm tra (Verify)
- Chưa chạy lại build/test trong lượt đẩy này (được yêu cầu push trực tiếp).

### Bàn giao / Tiếp theo cho máy kia
- Sau khi `git pull`, chạy `npm run build` và `npm test` trong `GameVault/` để xác nhận đồng bộ.
- Kiểm tra `HANDOFF_GAME_CLASSIFICATION.md` và các migration mới (`0005`–`0008`) nếu cần chạy trên D1 remote.

## [2026-11-26 13:49] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- Đã chạy migration `worker/migrations/0004_library_sync_epoch.sql` lên D1 production (`game-vault-d1`) và deploy Worker mới (`7b123049-3441-4bf2-a1b6-fe66a157afbc`).

### Kiểm tra (Verify)
- `npx wrangler d1 execute game-vault-d1 --remote --file=worker/migrations/0004_library_sync_epoch.sql`: Thành công (`success: true`).
- `npm run deploy:worker`: Build `admin-web`, `community-web` và deploy `game-vault-worker` thành công (Version ID `7b123049-3441-4bf2-a1b6-fe66a157afbc`).

### Bàn giao / Tiếp theo cho máy kia
- Khi máy kia `git pull` về:
  1. Chạy `npm run build` rồi **thoát hẳn app GameVault đang chạy ngầm ở System Tray** (nếu có) và mở lại bản mới.
  2. Trên máy chuẩn (`DESKTOP-BU4IIOC`), mở **Đồng bộ** → bấm **Đặt máy này làm chuẩn (Ghi đè Cloud)** (1 lần).
  3. Trên máy kia, chỉ cần mở app hoặc bấm **Đồng bộ** bình thường: app sẽ tự nhận `sync_epoch` mới (`authoritativePull: true`), tự kéo lại toàn bộ thư viện & `sessions` chuẩn từ Cloud (tự sửa/giảm giờ chơi bị lệch và xóa game/session rác).

## [2026-11-26 13:46] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Bổ sung cơ chế Đồng bộ chuẩn hóa theo `sync_epoch` & Chế độ Ghi đè Cloud (`mode: 'overwrite'`)**:
  - Cho phép chọn **Đặt máy này làm chuẩn (Ghi đè Cloud)** trong `SyncModal` để xóa dữ liệu lệch (`user_library`, `user_sessions`) trên Cloud và nạp 100% dữ liệu từ máy chuẩn, đồng thời tăng `sync_epoch` trong `user_sync_state`.
  - Khi máy khác bấm **Đồng bộ** bình thường với `clientSyncEpoch < serverSyncEpoch`, Worker từ chối merge dữ liệu lệch từ máy đó lên và trả về `authoritativePull: true` kèm bản chuẩn từ Cloud; Client tự động mirror chính xác `playtime_minutes` (cho phép giảm giờ thừa), `status`, `completed_at`, xóa game/session rác và nạp lại `sessions` chuẩn.

### File chính đã thay đổi
- `worker/src/routes/library.ts`, `worker/schema.sql`, `worker/migrations/0004_library_sync_epoch.sql`: Thêm `user_sync_state`, xử lý `mode: 'overwrite'`, kiểm tra `clientSyncEpoch` và trả `authoritativePull`.
- `src/main/cloud-db.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`: Lưu `library_sync_epoch` trong `app_settings`, truyền `LibrarySyncOptions`, xử lý mirror toàn bộ thư viện & `sessions` khi `authoritativePull = true`.
- `src/renderer/components/SyncModal.tsx`: Thêm nút **Đặt máy này làm chuẩn (Ghi đè Cloud)** và thông báo khi kéo bản chuẩn từ Cloud.
- `tests/library-sync.test.js`: Bổ sung test kiểm tra luồng overwrite trên máy chuẩn → máy lệch tự động pull về khớp 100% → sync cộng thêm giờ sau đó bình thường.

### Kiểm tra (Verify)
- `npm run build` (Electron main/preload + Vite): Pass.
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass.
- `npm test`: **479/479 tests pass** (`96 suites`, `0 fail`, `0 skipped`).

### Bàn giao / Tiếp theo
- Chạy migration `worker/migrations/0004_library_sync_epoch.sql` lên D1 production (`game-vault-d1`) và `npm run deploy:worker`.
- Sau khi deploy: trên máy chuẩn bấm **Đặt máy này làm chuẩn (Ghi đè Cloud)** trong `SyncModal`; trên máy kia mở app (thoát hẳn Tray nếu đang mở bản cũ) và bấm **Đồng bộ** để tự kéo toàn bộ dữ liệu chuẩn về.

## [2026-11-26 13:42] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- **Lịch sử hoạt động (`ProfileActivity.tsx`)**: Thêm `excludeKind=review` khi tải `Bài đã đăng`, đảm bảo chỉ hiển thị bài đăng mạng xã hội từ Bảng tin (không lẫn bài đánh giá sao).
- **Loại bỏ app/game treo máy khỏi BXH giờ chơi (`worker/src/routes/community.ts`)**: Thêm bộ lọc `notIdleSql` / `IDLE_APP_KEYS` & `IDLE_APP_TITLES` (`TBH: Task Bar Hero`, `Wallpaper Engine`, `Lossless Scaling`, `Bongo Cat`, `Banana`, `Desktop Mate`, `VTube Studio`) ở `/rankings`, `/players`, `/me`, `/profiles/:uid` — nhờ vậy `Crimson Desert` (220h) đứng top #1 giờ chơi và làm banner chính xác.
- **Chuyển `Top game` & `Top người chơi` sang danh sách xếp hạng theo chiều dọc (`CommunityHub.tsx`, `PlayerBoard.tsx`, `community.css`)**:
  - `Top game`: Danh sách 1 cột xếp hạng từ trên xuống dưới (`.gv-game-list` / `.gv-game-row`), mỗi hàng có ảnh bìa nền mờ atmospheric, poster đứng lớn (`92×130` cho Top 3, `78×110` cho #4+), thông tin đánh giá và 3 ô thống kê + điểm.
  - `Top người chơi`: Danh sách 1 cột xếp hạng từ trên xuống dưới (`.gv-player-list` / `.gv-player-row`), hiển thị Top 3 game chơi nhiều nhất ở cột bên phải ngay trong hàng thay vì popup `position: absolute` bị cắt ở mép dưới màn hình.

### File chính đã thay đổi
- `src/renderer/community/ProfileActivity.tsx`
- `src/renderer/community/PlayerBoard.tsx`
- `src/renderer/community/CommunityHub.tsx`
- `src/renderer/community/community.css`
- `worker/src/routes/community.ts`

### Kiểm tra (Verify)
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass (exit 0).
- `npm run build`, `npm run build:admin`, `npm run build:community`: Pass.
- `npm test`: **478 pass / 0 fail / 0 skipped** (96 suites).

### Bàn giao cho máy kia (Notes / Next)
- Đã deploy Worker + `/community/` assets lên Cloudflare (`game-vault-worker`).
- Thoát hẳn GameVault Desktop (kể cả System Tray) và mở lại để nạp bản build UI mới.

## [2026-11-26 12:55] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- Thiết kế lại toàn bộ giao diện tab **Top game cộng đồng** (`CommunityHub.tsx` + `community.css`):
  - Gom thanh tìm kiếm và bộ lọc sắp xếp vào một toolbar full-width gọn gàng (`.gv-topgames-toolbar`).
  - Thay podium và danh sách hàng ngang ảnh nhỏ bằng **Card Showcase lưới 3 cột** (`.gv-podium-grid` cho Top 3 và `.gv-game-grid` cho hạng #4+): mỗi card có ảnh bìa rộng (`bannerUrl` / Steam header / blurred poster fallback), poster đứng kích thước lớn (`86×124` cho Top 3, `74×106` cho hạng #4+) chồng lên banner, huy hiệu hạng + điểm đánh giá nổi trên góc, và cụm 3 ô thống kê (`Giờ chơi`, `Người chơi`, `Phá đảo`) đầy đặn không còn khoảng trống thừa.
- Bổ sung trường `bannerUrl` trong `GET /api/community/rankings` (`worker/src/routes/community.ts` & `src/shared/community.ts`).

### File chính đã thay đổi
- `src/shared/community.ts`
- `worker/src/routes/community.ts`
- `src/renderer/community/CommunityHub.tsx`
- `src/renderer/community/community.css`

### Kiểm tra (Verify)
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass (exit 0).
- `npm run build`, `npm run build:admin`, `npm run build:community`: Pass.
- `npm test`: **478 pass / 0 fail / 0 skipped** (96 suites).

### Bàn giao cho máy kia (Notes / Next)
- Đã deploy Worker + `/community/` assets lên Cloudflare (`game-vault-worker`).
- Thoát hẳn GameVault Desktop (kể cả System Tray) và mở lại để nạp UI mới.

## [2026-11-26 12:51] — Máy: DESKTOP-BU4IIOC — Branch: main

### Tóm tắt công việc
- Thiết kế lại trang **Hồ sơ** (`Hồ sơ` tab & public profile) theo phong cách Discord / Threads / Facebook: cover banner (từ game chơi nhiều nhất), avatar chồng lên banner (`referrerPolicy="no-referrer"`), bio, thống kê (`Thư viện`, `Đã phá đảo`, `Giờ chơi`), sub-tabs (`Lịch sử hoạt động` | `Thư viện của tôi`), và nút **"Chỉnh sửa hồ sơ"** mở modal chỉnh sửa/riêng tư (không còn hiện form + nút "Lưu hồ sơ" thường trực).
- Thiết kế lại **Top người chơi** (`PlayerBoard.tsx`): thẻ player có cover banner, avatar, thống kê, game top #1, và hover để xem preview Top 3 game chơi nhiều giờ nhất (poster, tên, giờ chơi, trạng thái).
- Làm sạch **Lịch sử hoạt động** (`ProfileActivity.tsx` + `PostCard.tsx` prop `hideSave`): chỉ hiển thị lịch sử bài đăng và bình luận của bản thân, bỏ nút "Lưu" dư thừa.
- Bổ sung dữ liệu Worker (`worker/src/routes/community.ts` & `src/shared/community.ts`): trả `bannerUrl` + tổng thống kê ở `/me` và `/profiles/:uid`, và trả `bio`, `bannerUrl`, `topGames` ở `/players?includeTopGames=1` (giữ nguyên payload mặc định cho backward-compatibility).
- Khắc phục tải avatar Google (`Avatar` dùng `referrerPolicy="no-referrer"` và giữ fallback `photoUrl` từ shell auth trong `identity.ts`).

### File chính đã thay đổi
- `src/shared/community.ts`
- `worker/src/routes/community.ts`
- `src/renderer/community/CommunityWidgets.tsx`
- `src/renderer/community/identity.ts`
- `src/renderer/community/PostCard.tsx`
- `src/renderer/community/ProfileActivity.tsx`
- `src/renderer/community/PlayerBoard.tsx`
- `src/renderer/community/CommunityHub.tsx`
- `src/renderer/community/community.css`

### Kiểm tra (Verify)
- `npx tsc --noEmit -p worker/tsconfig.json`: Pass (exit 0).
- `npm run build` / `npm run build:admin` / `npm run build:community`: Pass.
- `npm test`: **478 pass / 0 fail / 0 skipped** (96 suites).

### Bàn giao cho máy kia (Notes / Next)
- Đã deploy Worker + `/community/` assets lên Cloudflare (`game-vault-worker`).
- Thoát hẳn GameVault Desktop (kể cả System Tray) và mở lại để nạp bản build UI mới.

## [2026-11-26 12:46] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Thiết kế lại card Top 3 & danh sách Top game rõ nhãn tiếng Việt (`Giờ chơi`, `Người chơi`, `Phá đảo`, `★ điểm/10`), sửa lỗi CSS specificity làm `.gv-rank-row` bị co giữa, đặt mặc định Top game sắp theo `Tổng giờ chơi` + tie-break theo điểm đánh giá, cập nhật `DesktopCommunity` tự refresh sau khi sync điểm, và bật `share_library = 1` + nạp `community_library` (55 game) cho tài khoản trên production D1.
- **Thay đổi chính:**
  - `src/renderer/community/community.css`: Thêm `!important` cho `.gv-rank-row` grid (`44px minmax(0, 1fr) auto`), `min-width: 0; width: 100%; overflow-x: hidden;` cho `.gv-community`/`.gv-stack`, và `.gv-stat-mini-grid` cho Top 3.
  - `src/renderer/community/CommunityHub.tsx`: Đổi sắp xếp mặc định Top game sang `hours` (`Tổng giờ chơi`), bỏ các pill số `0` tối nghĩa và thay bằng nhãn rõ ràng (`Giờ chơi`, `Người chơi`, `Phá đảo`, `X lượt đánh giá`, `★ X.X/10`).
  - `src/renderer/community/DesktopCommunity.tsx`: Refresh `reviewVersion` khi `syncReviews()` có `synced > 0 || migrated > 0`.
  - `worker/src/routes/community.ts`: Sắp xếp tie-break `/rankings` theo `COALESCE(r.averageScore,0) DESC, COALESCE(r.reviewCount,0) DESC`.
- **Kiểm tra:**
  - `npx tsc --noEmit -p worker/tsconfig.json`, `npm run build`, `npm run build:admin`, `npm run build:community`: Pass.
  - `npm test`: **478/478 tests pass** (`96 suites`, `0 fail`, `0 skipped`).
  - Cloudflare Production (`16cefe57-85f4-4684-ad04-542d07f6399b` & D1 `game-vault-d1`): Đã bật `share_library = 1` và đồng bộ `55` game vào `community_library`; kiểm tra live `/api/community/rankings?sort=hours` đã trả đủ `Crimson Desert` (`220 giờ`, `10 điểm`, `1 phá đảo`), `Sekiro` (`104 giờ`, `10 điểm`), `Red Dead Redemption 2` (`90 giờ`, `10 điểm`), `FFVII Rebirth` (`84 giờ`, `10 điểm`).
- **Bàn giao / Tiếp theo:** Thoát hẳn app GameVault (kể cả System Tray) rồi mở lại để nạp giao diện Top game mới và xem số liệu thực tế đầy đủ.

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
