# Pending Push & Deploy Handoff (`PENDING_PUSH.md`)

File `GameVault/PENDING_PUSH.md` dùng để bàn giao các thay đổi chưa push/deploy giữa các session AI khác nhau.

## 1. Khi bắt đầu session hoặc trước khi push/deploy
- Luôn đọc `GameVault/PENDING_PUSH.md` nếu file tồn tại để nắm các thay đổi từ các session trước (code đã sửa, migration D1 cần chạy, lệnh deploy Worker/Pages, biến môi trường/secret mới, lưu ý nhánh `dev` vs `main`).

## 2. Sau khi code xong (chưa push/deploy)
- Mỗi session khi hoàn thành một phần code mà **chưa** push hoặc **chưa** deploy phải **ghi bổ sung** (append) vào `GameVault/PENDING_PUSH.md`:
  - **Phạm vi thay đổi**: Tóm tắt ngắn gọn tính năng/bugfix và các file chính đã sửa.
  - **Cách đẩy / Deploy bắt buộc**: Ghi rõ lệnh cần chạy trước hoặc sau khi push (ví dụ: `npx wrangler d1 migrations apply game-vault-d1 --remote`, `npm run deploy:worker`, tăng `version` trong `package.json`, nhánh đích `dev` hoặc `main`).
  - **Trạng thái kiểm tra**: Kết quả `tsc` / `npm run build` / `npm test`.

## 3. Sau khi push & deploy xong
- Session nào thực hiện xong việc **push code** (và chạy hết các lệnh deploy/migration đi kèm trong `PENDING_PUSH.md`) phải **tự làm sạch** `GameVault/PENDING_PUSH.md` (xóa các mục đã đẩy xong, đưa file về trạng thái rỗng/mẫu sạch để sẵn sàng cho đợt code tiếp theo) và commit trạng thái sạch đó nếu cần.
