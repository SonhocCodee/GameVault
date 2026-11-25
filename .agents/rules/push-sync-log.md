---
trigger: always_on
description: "Bắt buộc đọc PUSH_LOG.md khi bắt đầu/pull và cập nhật tóm tắt vào PUSH_LOG.md trước mỗi lần git push; tự đồng bộ rule sang global trên máy mới."
---

# Quy tắc đồng bộ code 2 máy (`PUSH_LOG.md`)

Dự án này được làm việc luân phiên trên **2 máy khác nhau**. Để AI và người dùng ở cả hai máy luôn nắm được trạng thái mới nhất, hãy tuân thủ nghiêm ngặt 3 quy tắc sau:

## 1. Tự cài đặt Global Rule trên máy còn lại (chạy 1 lần nếu chưa có)
- Khi mở hoặc pull repo này trên một máy mới, hãy kiểm tra xem file global rule tại `~/.gemini/config/rules/push-sync-log.md` (Windows: `%USERPROFILE%\.gemini\config\rules\push-sync-log.md`) đã tồn tại chưa.
- Nếu **chưa tồn tại**, hãy **tự động tạo** file `~/.gemini/config/rules/push-sync-log.md` với cùng cơ chế rule này (áp dụng cho mọi repo có `PUSH_LOG.md`) để AI trên máy đó luôn ghi nhớ quy tắc ở mức global.

## 2. Đọc `PUSH_LOG.md` khi bắt đầu phiên hoặc sau khi `git pull`
- Trước khi bắt đầu code, sửa lỗi, hoặc ngay sau khi chạy `git pull` từ máy kia, hãy đọc các mục mới nhất ở đầu file `PUSH_LOG.md`.
- Nắm rõ: máy kia vừa thêm/sửa gì, các file liên quan, trạng thái build/test, và các ghi chú bàn giao (`Next / Notes`) trước khi tiếp tục công việc.

## 3. Cập nhật `PUSH_LOG.md` trước mỗi lần `git push`
- **Không bao giờ `git push`** mà chưa cập nhật `PUSH_LOG.md`.
- Trước khi commit & push (hoặc bổ sung commit ngay trước khi push), hãy **chèn mục mới nhất lên trên cùng** ngay dưới dòng `<!-- LATEST_FIRST -->` trong `PUSH_LOG.md`.
- Nội dung mỗi lượt đẩy cần ngắn gọn, chính xác và đầy đủ:
  - **Thời gian & Máy**: `YYYY-MM-DD HH:mm` — Tên máy (`hostname` / `$env:COMPUTERNAME`) — Nhánh (`branch`)
  - **Tóm tắt công việc**: Đã làm những gì trong lượt đẩy này (tính năng, sửa lỗi, cấu hình...)
  - **File chính đã thay đổi**: Liệt kê các file/module quan trọng
  - **Kiểm tra (Verify)**: Build / test / lint đã chạy và kết quả thực tế (hoặc ghi rõ nếu chưa chạy)
  - **Bàn giao cho máy kia (Notes / Next)**: Việc còn dang dở, lưu ý môi trường, hoặc bước tiếp theo nếu có
- Luôn stage và commit `PUSH_LOG.md` cùng đợt đẩy code đó lên remote.
