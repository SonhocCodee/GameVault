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
