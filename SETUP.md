# GameVault Cloud — SETUP (làm 1 lần bởi người phân phối app)

App dùng **Google login** (OAuth desktop PKCE, browser thật) + **Cloudflare Workers & D1 Database** cho review/bảng xếp hạng + **Google Drive & Google Photos** cho backup save và ảnh riêng tư.
**Hoàn toàn 100% Free Tier, không tốn chi phí.**

Làm theo thứ tự dưới đây, mất ~5-10 phút. Xong thì chép `cloud-config.json` cạnh app và gửi cho bạn bè — họ chỉ cần bấm **Đăng nhập**.

---

## 1. Tạo OAuth Client (Desktop) trên Google Cloud Console (5 phút)

1. Vào https://console.cloud.google.com → Chọn hoặc tạo project mới.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - Điền App name + email hỗ trợ → Save qua hết các bước.
   - Mục **Test users** → **Add users** → thêm Gmail của bạn + bạn bè.
3. **APIs & Services → Library** → bật 2 API:
   - **Google Drive API** (để backup save lên Drive cá nhân)
   - **Google Photos Library API** (để lưu trữ ảnh/screenshots lên Google Photos cá nhân)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Copy **Client ID** → `oauthClientId`
   - Copy **Client Secret** → `oauthClientSecret`

---

## 2. Tạo Cloudflare Backend (Đã hoàn tất cho bạn)

1. Database D1 `game-vault-d1` đã được tạo và nạp sẵn schema trên Cloudflare.
2. Worker đã deploy thành công tại:
   `https://game-vault-worker.gamevault-son.workers.dev`

---

## 3. Tạo file `cloud-config.json`

Tạo file `cloud-config.json` cạnh file thực thi/app hoặc thư mục gốc:

```json
{
  "oauthClientId": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  "oauthClientSecret": "GOCSPX-YOUR_CLIENT_SECRET",
  "workerApiUrl": "https://game-vault-worker.gamevault-son.workers.dev"
}
```

---

## 4. Kiểm tra hoạt động

1. Chạy app: `npm run dev`
2. Bấm nút **Đăng nhập** trên Navbar → Trình duyệt mở trang đăng nhập Google → Chọn tài khoản → Allow.
3. Vào tab **Cộng đồng** → Thử đăng review một game → Bảng xếp hạng cập nhật ngay tức thì từ Cloudflare D1!
4. Mở **Cài đặt** (Settings) → Tab **Lưu trữ ảnh & Cloud**:
   - Chọn **Google Photos cá nhân** để lưu ảnh trực tiếp vào tài khoản Google của bạn.
   - Hoặc chọn **Cloudflare R2** nếu bạn có cấu hình S3 riêng.
