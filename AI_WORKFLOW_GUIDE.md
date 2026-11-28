# HƯỚNG DẪN LUỒNG LÀM VIỆC, NHÁNH GIT & ĐẨY APP (DÀNH CHO AI / AGENT)

> **Đọc kỹ từ trên xuống dưới trước khi đụng vào bất kỳ dòng code hay lệnh `git` nào.**
> Tài liệu này tổng hợp toàn bộ quy trình làm việc thực tế của dự án **GameVault** để AI không làm sai nhánh, không quên cập nhật log, không đẩy nhầm bản release và không làm lộ secret.

---

## 1. Vị trí thư mục & Git Repository (Hay nhầm nhất!)

- Workspace mở lên có thể là `D:\Son\Vibe\Gamevault`, **NHƯNG Git repository nằm bên trong thư mục `GameVault/`** (`D:\Son\Vibe\Gamevault\GameVault`).
- Mọi lệnh `git`, `npm`, `npx tsc`, `npx wrangler` **BẮT BUỘC** phải chạy bên trong `GameVault/`:
  ```powershell
  cd D:\Son\Vibe\Gamevault\GameVault
  ```
- Cấu trúc chính trong `GameVault/`:
  - `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/` — App Electron (React + Vite + TypeScript + SQLite local).
  - `worker/` — Backend Cloudflare Worker + D1 SQLite (`game-vault-d1`), migrations nằm ở `worker/migrations/`.
  - `admin-web/` — Web Admin Dashboard (build ra `worker/admin-assets`, phục vụ tại `/admin` qua Worker).
  - `community-web/` — Web Community.
  - `.github/workflows/ci.yml` — CI kiểm tra cho nhánh `dev` / `test`.
  - `.github/workflows/release.yml` — Auto-build & Publish bộ cài Windows lên GitHub Releases cho nhánh `main` / tag `v*`.

---

## 2. Quy trình BẮT BUỘC khi BẮT ĐẦU phiên làm việc

1. **Đọc 2 file bàn giao trước khi sửa code:**
   - `GameVault/PUSH_LOG.md`: Đọc mục mới nhất ở đầu file (ngay dưới `<!-- LATEST_FIRST -->`) để biết máy kia vừa sửa gì, deploy gì, còn lưu ý gì.
   - `GameVault/PENDING_PUSH.md`: Kiểm tra xem có thay đổi nào đã code xong nhưng chưa push/deploy không.
2. **Nếu vừa chạy `git pull` (hoặc được yêu cầu pull code):**
   - Sau khi `git pull` xong, **LUÔN tự động chạy ngay**:
     ```powershell
     npm run build
     ```
   - Không cần hỏi lại người dùng.

---

## 3. Làm trên nhánh nào? (Branching Strategy)

Dự án tách làm 2 loại nhánh rõ ràng. **TUYỆT ĐỐI KHÔNG PUSH NHẦM NHÁNH!**

### A. Nhánh `dev` hoặc `test` — Dùng để code, thử nghiệm, chưa phát hành
- Khi nào dùng: Đang phát triển tính năng mới, sửa lỗi đang test dở, chưa muốn phát hành bản cập nhật cho người dùng cuối.
- Điều gì xảy ra khi `git push` lên `dev` hoặc `test`?
  - GitHub Actions (`.github/workflows/ci.yml`) **CHỈ chạy kiểm tra**:
    - `npx tsc --noEmit`
    - `npm run build`
    - `npm test`
  - **KHÔNG** build file `.exe`, **KHÔNG** tạo GitHub Release, **KHÔNG** kích hoạt auto-update.
- Cách chuyển/tạo nhánh nếu chưa có local:
  ```powershell
  git checkout -b dev   # nếu chưa có nhánh dev
  # hoặc
  git checkout dev
  ```

### B. Nhánh `main` — Nhánh PRODUCTION & AUTO-RELEASE
- **CẢNH BÁO QUAN TRỌNG:** Mỗi lần `git push` lên `main` (hoặc push tag `v*`), GitHub Actions (`.github/workflows/release.yml`) sẽ **TỰ ĐỘNG BUILD BỘ CÀI WINDOWS VÀ PUBLISH CÔNG KHAI LÊN GITHUB RELEASES**, kích hoạt **auto-update** tải về máy tất cả người dùng đang mở app!
- Chỉ merge/push vào `main` khi:
  1. Code đã test kỹ, sẵn sàng phát hành.
  2. Đã **tăng `version`** trong `GameVault/package.json` (ví dụ `1.0.8` → `1.0.9`). Nếu quên tăng `version`, workflow sẽ đụng tag `v<version>` cũ trên GitHub Releases!
  3. Giữ nguyên `"releaseType": "release"` trong `build.publish` của `GameVault/package.json`.

---

## 4. Quy trình ĐẨY APP (Deploy Backend + Release App Windows)

> **Lưu ý cực kỳ quan trọng:** GitHub Actions (`release.yml`) **CHỈ build app Electron Windows**, **KHÔNG** tự deploy Cloudflare Worker hay chạy D1 migration. Nếu có sửa `worker/`, `admin-web/`, `community-web/` hoặc SQL migration, bạn **PHẢI deploy Worker thủ công trước** rồi mới push `main` để release app!

### Bước 1: Deploy Backend Cloudflare (chỉ chạy nếu có sửa `worker/`, `admin-web/`, `community-web/`, hoặc thêm file `.sql` trong `worker/migrations/`)

1. Nếu có file migration mới trong `worker/migrations/`:
   ```powershell
   npx wrangler d1 migrations apply game-vault-d1 --remote
   ```
2. Kiểm tra secret trên Cloudflare (chỉ làm khi mới setup hoặc xoay khóa; không bao giờ đưa secret vào git):
   ```powershell
   npx wrangler secret list
   # Nếu thiếu SESSION_SECRET (bắt buộc >= 32 ký tự ngẫu nhiên):
   npx wrangler secret put SESSION_SECRET
   ```
3. Build Web Admin + Community & Deploy Worker:
   ```powershell
   npm run deploy:worker
   ```
   *(Lệnh này trong `package.json` tự chạy: `npm run build:admin && npm run build:community && npx wrangler deploy`)*

### Bước 2: Chuẩn bị bản Release App Electron (nếu đẩy lên `main` để phát hành)

1. **Tăng `version`** trong `GameVault/package.json` (ví dụ `"version": "1.0.8"` → `"1.0.9"`).
2. **Cập nhật Changelog** trong `GameVault/src/shared/changelog.ts` (`CHANGELOG_ENTRIES`) cho phiên bản mới để người dùng thấy thông báo "Đã fix gì / What's New" sau khi auto-update.

### Bước 3: Kiểm tra & Build sạch tại máy local (BẮT BUỘC trước mọi lần push)

Chạy tuần tự các lệnh sau trong `GameVault/`:
```powershell
Remove-Item -Force -ErrorAction SilentlyContinue dist-electron/cloud-config.json, dist-electron/*.map
npx tsc --noEmit
npx tsc --noEmit -p worker/tsconfig.json
npm run build
npm test
```
Tất cả phải **PASS 100%** (không lỗi typecheck, không lỗi build, không test fail).

### Bước 4: Cập nhật `PUSH_LOG.md` & `PENDING_PUSH.md` (BẮT BUỘC)

1. **Trước khi `git push`**, mở `GameVault/PUSH_LOG.md` và **chèn mục mới nhất lên trên cùng**, ngay bên dưới dòng `<!-- LATEST_FIRST -->` theo mẫu:
   ```markdown
   ## [YYYY-MM-DD HH:mm] — Máy: <TÊN_MÁY> — Branch: <nhánh>

   ### Tóm tắt công việc
   - ...

   ### File chính đã thay đổi
   - ...

   ### Kiểm tra (Verify)
   - `npx tsc --noEmit`, `npx tsc --noEmit -p worker/tsconfig.json`, `npm run build`, `npm test` — PASS.

   ### Bàn giao cho máy kia (Notes / Next)
   - ...
   ```
2. **Xử lý `GameVault/PENDING_PUSH.md`**:
   - Nếu phiên này **đã push và deploy xong toàn bộ**: xóa các mục cũ, trả `PENDING_PUSH.md` về trạng thái trống:
     ```markdown
     <!-- PENDING_ITEMS_START -->
     _(Hiện không có thay đổi nào đang chờ push/deploy.)_
     <!-- PENDING_ITEMS_END -->
     ```
   - Nếu phiên này **chưa push hoặc chưa deploy** (ví dụ mới code xong chưa đẩy): ghi rõ đã sửa gì, cần chạy lệnh gì trước/sau push vào `PENDING_PUSH.md` để phiên sau làm tiếp.

### Bước 5: Commit & Push

```powershell
git status --short
git add -A
git commit -m "<thông điệp rõ ràng>"
git push origin <tên-nhánh>   # 'dev'/'test' để test CI, hoặc 'main' để Auto-Release!
```

### Bước 6: GitHub Actions tự làm gì sau khi push `main`?

Khi push lên `main` (hoặc push tag `v*`), `.github/workflows/release.yml` tự chạy trên `windows-latest`:
1. `npm ci` → `npx tsc --noEmit` → `npm run build` → xóa `dist-electron/cloud-config.json` & `dist-electron/*.map`.
2. Chạy `npx electron-builder --win --publish always` ở chế độ `draft` (tạo bộ cài `nsis-web`, `nsis`, `portable` x64).
3. Upload thêm `release/latest.yml` lên release `v$version` (đảm bảo `electron-updater` không bị lỗi 404).
4. Chuyển release từ `draft` sang public (`gh release edit "v$version" --draft=false`).

---

## 5. Đóng gói `.exe` thủ công trên máy Local (khi cần file `.exe` trực tiếp mà không qua GitHub Actions)

1. Chạy sạch **Bước 3** ở trên (`tsc`, `build`, `test`, xóa `dist-electron/cloud-config.json` và `dist-electron/*.map`).
2. Chạy:
   ```powershell
   npm run pack:win
   ```
   *(Chạy `electron-builder --win`, xuất file ra `GameVault/release/`)*
3. **Kiểm tra gói đầu ra** trước khi gửi cho người dùng: trong `release/win-unpacked/resources/` tuyệt đối **KHÔNG** được chứa `worker/`, `admin-web/`, `community-web/`, `status-worker/`, `.dev.vars`, `cloud-config.json`, `*.map`, `gamevault.db`, `auth-session.json`.

---

## 6. Các điều CẤM TUYỆT ĐỐI (Vi phạm là toang)

1. **KHÔNG hardcode secret** (`SESSION_SECRET`, `TWITCH_CLIENT_SECRET`, API token...) vào `wrangler.toml`, `cloud-config.json`, code Electron hoặc frontend. Dev local dùng `GameVault/.dev.vars` (đã gitignore); Production dùng `npx wrangler secret put <NAME>`.
2. **KHÔNG push lên `main` khi chưa chốt phát hành hoặc quên tăng `version` trong `package.json`**.
3. **KHÔNG `git push` khi chưa cập nhật `PUSH_LOG.md`**.
4. **KHÔNG viết query D1 quét toàn bảng (full-table scan) hoặc query trong vòng lặp (N+1)**: hệ thống đang chạy gói **Cloudflare Free** (giới hạn `5,000,000` rows read/ngày, `100,000` rows written/ngày, `100,000` requests/ngày). Luôn dùng index, `LIMIT`, `JOIN`/`IN`/`env.DB.batch()`, chỉ `INSERT`/`UPDATE` khi dữ liệu thực sự đổi.
5. **KHÔNG xóa hoặc sửa comment/docstring cũ không liên quan** khi chỉnh sửa code.
