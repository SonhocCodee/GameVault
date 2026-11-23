# GameVault Cloud — SETUP (làm 1 lần bởi người phân phối app)

App dùng **Google login** (OAuth desktop, browser thật — không kẹt file:// như Firebase SDK)
+ **Firestore** cho review/bảng xếp hạng + **Drive appDataFolder** cho backup save riêng tư.

Làm theo thứ tự dưới đây, mất ~10-15 phút. Xong thì chép `cloud-config.json` cạnh app
và gửi cho bạn bè — họ chỉ cần bấm **Đăng nhập**.

---

## 1. Tạo Firebase project (5 phút)

1. Vào https://console.firebase.google.com → **Add project** → đặt tên (vd `gamevault`)
2. **Build → Authentication → Get started → Google → Enable** → đặt email hỗ trợ → Save
3. **Build → Firestore Database → Create database** → chế độ **Production mode** (sau đó dán rules ở mục 4) → location tùy ý
4. **Project settings (bánh răng) → General → Your apps → Web (`</>`)** → đăng ký app (không cần hosting)
   → copy giá trị **`apiKey`** → đó chính là **`firebaseApiKey`**
   → copy **`projectId`** → đó là **`firebaseProjectId`**

## 2. Tạo OAuth Client (Desktop) — để login Google (5 phút)

1. Vào https://console.cloud.google.com → **chọn đúng project** vừa tạo (switcher đầu trang)
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - Điền App name + email → Save qua hết các bước
   - Mục **Test users** → **Add users** → thêm Gmail của bạn + bạn bè (giới hạn 100 user khi app ở chế độ Testing — đủ cho nhóm bạn; muốn vô hạn thì **Publish app**)
3. **APIs & Services → Library** → bật 2 cái:
   - **Google Drive API** (cho backup save lên Drive)
   - *(Identity Toolkit đã bật sẵn bởi Firebase Auth)*
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Copy **Client ID** → `oauthClientId`
   - Copy **Client Secret** → `oauthClientSecret`

## 3. Tạo cloud-config.json

Chép `cloud-config.json.example` thành `cloud-config.json` (cạnh exe/app) và điền:

```json
{
  "oauthClientId": "XXXX.apps.googleusercontent.com",
  "oauthClientSecret": "GOCSPX-XXXX",
  "firebaseApiKey": "AIzaXXXX",
  "firebaseProjectId": "ten-project-firebase"
}
```

> Client secret của loại "Desktop app" không phải bí mật tối	Object — Google thiết kế vậy.

## 4. Dán Firestore security rules

Firebase console → Firestore Database → **Rules** → thay bằng nội dung file `firestore.rules`
(cạnh file này) → **Publish**.

Rules cho: ai cũng ĐỌC được (bảng xếp hạng công khai), nhưng CHỈ ghi được document của
chính mình (review/profile/vote).

## 5. Kiểm tra

1. Chạy app → Navbar hiện nút **Đăng nhập** → bấm → browser Google mở → chọn tài khoản → Allow
2. Tab **Cộng đồng** → đăng review 1 game trong thư viện → leaderboard hiện game đó
3. Trong game detail → **Lưu trữ Save** → backup 1 bản → bấm icon **Lên Drive**
   → kiểm tra Drive web → thư mục ẩn **appDataFolder** (Settings Drive không hiện — xem bằng app hoặc https://drive.google.com/drive/my-drive sau khi bật "hiện dữ liệu app")

## Luồng kỹ thuật (để debug)

- Login: app mở HTTP server tạm trên `127.0.0.1:<port ngẫu nhiên>` → mở browser với PKCE S256
  → Google redirect về loopback → đổi `code` lấy token → gọi Firebase REST
  `accounts:signInWithIdp` → lấy Firebase ID token (hết hạn 1h, tự refresh ngầm)
- Cloud: mọi call Firestore qua REST (`:runQuery`, PATCH document) kèm Bearer token
- Drive: upload multipart vào `appDataFolder/GameVault/<Game>/<slot>/`
- Session lưu ở `%APPDATA%/game-vault/auth-session.json` — xóa file này = đăng xuất cưỡng bức
