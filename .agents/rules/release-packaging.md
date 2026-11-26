# Quy trình Deploy Production & Đóng gói bộ cài `.exe` (`release-packaging`)

Tài liệu này là checklist bắt buộc để AI thực hiện mỗi khi người dùng yêu cầu **deploy production**, **đóng gói app**, **build `.exe`** hoặc **tạo bộ cài phát hành**.

---

## Bước 1: Kiểm tra & xoay khóa `SESSION_SECRET` trên Cloudflare Production
`wrangler.toml` không còn lưu `SESSION_SECRET` trong repo. Trước khi `deploy:worker` (hoặc khi chưa xoay khóa sau lần gỡ khỏi git):

```powershell
cd D:\Son\Vibe\Gamevault\GameVault
npx wrangler secret list
# Bắt buộc đặt / xoay khóa ngẫu nhiên >= 32 ký tự (KHÔNG dùng lại chuỗi cũ từng nằm trong git):
npx wrangler secret put SESSION_SECRET
npm run deploy:worker
```

- **Lưu ý dev local (`wrangler dev`)**: tạo file `GameVault/.dev.vars` (đã nằm trong `.gitignore`) và đặt `SESSION_SECRET=<chuỗi-dev-ngẫu-nhiên-32+-ký-tự>`.
- Sau khi `npm run deploy:worker`, kiểm tra nhanh `/health` và luồng đăng nhập / API trước khi phát hành app.

---

## Bước 2: Build sạch & chạy kiểm thử
Chạy trong `D:\Son\Vibe\Gamevault\GameVault`:

```powershell
Remove-Item -Force -ErrorAction SilentlyContinue dist-electron/cloud-config.json, dist-electron/*.map
npx tsc --noEmit
npx tsc --noEmit -p worker/tsconfig.json
npm run build
npm test
```

Đảm bảo:
- Không còn file `*.map` hoặc `cloud-config.json` trong `dist-electron/`.
- Typecheck, build và toàn bộ test đều pass.

---

## Bước 3: Đóng gói `.exe` sạch bằng `electron-builder`
Khi cấu hình `build` trong `package.json` (hoặc `electron-builder.yml`) và chạy đóng gói Windows (NSIS):

- **Chỉ được đưa vào bundle**:
  - `dist/**/*`
  - `dist-electron/**/*` (không gồm `*.map` và `cloud-config.json`)
  - `assets/**/*`
  - `resources/**/*`
  - `package.json` và runtime `node_modules` cần thiết
- **Bắt buộc loại trừ hoàn toàn** (`!worker/**`, `!admin-web/**`, `!community-web/**`, `!status-worker/**`, `!.dev.vars*`, `!cloud-config.json`, `!**/*.map`, `!gamevault.db*`, `!auth-session.json`, `!tests/**`, `!scripts/**`, `!.agents/**`, `!.wrangler/**`).
- **Kiểm tra sau khi đóng gói**: rà lại `win-unpacked/resources/` (hoặc danh sách file trong `app.asar`) để xác nhận không có sourcemap, `cloud-config.json`, `.dev.vars`, `worker/`, `auth-session.json` hay `gamevault.db`.
