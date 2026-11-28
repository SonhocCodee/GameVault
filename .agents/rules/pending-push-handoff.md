# Pending Push & Deploy Handoff (`PENDING_PUSH.md`)

File `GameVault/PENDING_PUSH.md` dùng để bàn giao các thay đổi chưa push/deploy giữa các session AI khác nhau.

## 1. Khi bắt đầu session hoặc trước khi push/deploy
- Luôn đọc `GameVault/PENDING_PUSH.md` nếu file tồn tại để nắm các thay đổi từ các session trước (code đã sửa, migration D1 cần chạy, lệnh deploy Worker/Pages, biến môi trường/secret mới, lưu ý nhánh `dev` vs `main`).

## 2. Sau khi code xong (chưa push/deploy)
- Mỗi session khi hoàn thành một phần code mà **chưa** push hoặc **chưa** deploy phải **ghi bổ sung** (append) vào `GameVault/PENDING_PUSH.md`:
  - **Phạm vi thay đổi**: Tóm tắt ngắn gọn tính năng/bugfix và các file chính đã sửa.
  - **Cách đẩy / Deploy bắt buộc**: Ghi rõ lệnh cần chạy trước hoặc sau khi push (ví dụ: `npx wrangler d1 migrations apply game-vault-d1 --remote`, `npm run deploy:worker`, tăng `version` trong `package.json`, nhánh đích `dev` hoặc `main`).
  - **Trạng thái kiểm tra**: Kết quả `tsc` / `npm run build` / `npm test`.
- Cập nhật mục handoff ngay sau mỗi thay đổi code tiếp theo, không đợi đến lúc chuẩn bị push; nếu đã có mục đang mở thì bổ sung vào mục đó thay vì để kết quả cũ gây hiểu nhầm.
- Ghi chính xác các lệnh kiểm tra cần chạy cho phần vừa sửa và trạng thái thực tế của từng lệnh (`PASS`, `FAIL`, hoặc `NOT RUN`). Nếu chưa chạy, ghi rõ lệnh còn phải chạy; không ghi là đạt nếu chưa thực thi.
- Ghi riêng mọi bước bắt buộc trước/sau khi push hoặc deploy: nhánh đích, yêu cầu tăng version/changelog khi phát hành, migration D1, deploy Worker, và bước xác minh production. Nếu không phát sinh bước nào, ghi rõ không cần migration/deploy.
- Trước mỗi lần push, đối chiếu `PENDING_PUSH.md` với diff hiện tại; cập nhật `PUSH_LOG.md` cùng kết quả kiểm tra thật. Nếu code đổi sau lần kiểm tra, đánh dấu kết quả cũ là hết hiệu lực và chạy lại các lệnh liên quan.

## 3. Sau khi push & deploy xong
- Session nào thực hiện xong việc **push code** (và chạy hết các lệnh deploy/migration đi kèm trong `PENDING_PUSH.md`) phải **tự làm sạch** `GameVault/PENDING_PUSH.md` (xóa các mục đã đẩy xong, đưa file về trạng thái rỗng/mẫu sạch để sẵn sàng cho đợt code tiếp theo) và commit trạng thái sạch đó nếu cần.
