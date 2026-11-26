# Quy tắc Bảo mật & Đóng gói GameVault (`security-hardening`)

Mọi thay đổi liên quan đến xác thực, lưu trữ bí mật, API Cloudflare Worker, upload/fetch ảnh và đóng gói Electron **BẮT BUỘC** tuân thủ các quy tắc dưới đây để không làm lộ lỗ hổng bảo mật.

## 1. Bí mật phía Server & Cấu hình triển khai
- **Cấm hardcode secret** (`SESSION_SECRET`, `TWITCH_CLIENT_SECRET`, API key/token) trong `wrangler.toml`, source code, `cloud-config.json` hoặc bundle Electron/renderer.
- Secret của Worker phải cấu hình qua Cloudflare Secrets (`npx wrangler secret put <NAME>`); môi trường local dùng `.dev.vars` (đã nằm trong `.gitignore`).
- `worker/src/auth.ts` phải kiểm tra `isValidSessionSecret(env.SESSION_SECRET)` (tối thiểu 32 ký tự, không trùng placeholder đã lộ) trước khi ký hoặc xác thực JWT.
- `ALLOW_MOCK_AUTH` tuyệt đối không được bật ở production; `verifyGoogleIdToken` luôn từ chối `mock:` token nếu `env.ENVIRONMENT === 'production'`.
- Không trả raw `err.message` ra HTTP 500 response ở `worker/src/index.ts`.

## 2. Xác thực, Phân quyền & Chống lạm dụng API
- Mặc định rằng người dùng có thể giải nén ASAR và đọc/sửa code Electron trên máy họ — mọi kiểm tra quyền phải thực hiện **phía Worker**.
- Không coi `oauthClientId` / `oauthClientSecret` của Desktop OAuth là secret bảo mật; luồng đăng nhập dựa trên PKCE + JWT do Worker ký.
- Mọi endpoint ghi dữ liệu hoặc chạm vào catalog dùng chung (`/api/covers/cache`, `/api/covers/upload`, `/api/images/upload`, `/api/admin/*`, `/api/community/*`) đều phải gọi `authenticate` / `requireUser` / `requireAdmin` và áp dụng `rateLimit`.
- Không cho user thường ghi đè cover/banner đã cache (`/api/images/...`) trong `game_covers` — chỉ admin (`isAdminUser`) mới được thay thế hoặc xóa cover catalog dùng chung.

## 3. Chống SSRF & Kiểm soát File Upload
- Mọi URL ảnh ngoài được Worker tải về (`ingestExternalImage`, `checkSingleImageUrl`, v.v.) phải kiểm tra qua `isAllowedExternalImageUrl`: chỉ cho phép `https:`, không chứa `username:password`, không port lạ, chặn `localhost`, `*.local`, `*.internal`, IP loopback/private/CGNAT/link-local (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `::1`, `fe80::`, `fc00::/7`, dạng IP số/hex).
- Đọc response từ URL ngoài bằng reader giới hạn byte (`readBoundedResponseBytes`, tối đa `MAX_IMAGE_SIZE_BYTES = 10MB`), không gọi `arrayBuffer()` không giới hạn.
- Endpoint upload ảnh bìa phải kiểm tra strict `ALLOWED_CONTENT_TYPES` (trả `415` nếu sai, không fallback sang `image/jpeg`), giới hạn kích thước (`413`) và xác minh magic bytes (`hasValidImageSignature`).
- Endpoint trả ảnh `/api/images/:key` phải gắn `X-Content-Type-Options: nosniff` và `Content-Security-Policy: default-src 'none'; sandbox`.

## 4. Bảo vệ Token, API Key Local & Electron Renderer
- Token phiên đăng nhập (`auth-session.json`) và mọi secret do người dùng nhập (`google_api_key`, `custom_s3_secret_access_key`, `igdbClientSecret`, `igdbToken`) phải mã hóa bằng `src/main/secure-storage.ts` (`encryptSecretString` / Electron `safeStorage` DPAPI) và ghi file qua `writePrivateFileAtomic`.
- Khi đọc qua IPC cho renderer (`settings:get`, `covers:getGoogleConfig`, `covers:getIgdbConfig`), phải che secret bằng `MASK_SECRET`; khi lưu lại, bỏ qua giá trị `MASK_SECRET` để không ghi đè secret thật.
- Luôn giữ `contextIsolation: true`, `nodeIntegration: false`, chặn `will-navigate` ra domain ngoài và chặn `setWindowOpenHandler` mở cửa sổ phụ trong `src/main/main.ts`.

## 5. Đóng gói bản phát hành sạch (Release Packaging)
- Build production Electron main/preload không xuất sourcemap (`sourcemap: false` trong `scripts/build.js`).
- Bộ cài phát hành (NSIS/portable) chỉ được đóng gói `dist/`, `dist-electron/`, `assets/`, `resources/` và `node_modules/` cần thiết; **tuyệt đối loại trừ** `worker/`, `admin-web/`, `community-web/`, `status-worker/`, `.dev.vars`, `cloud-config.json`, `*.map`, `auth-session.json`, `gamevault.db`, và thư mục dữ liệu cá nhân.
