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

## [2026-11-25 08:35] — Máy: DESKTOP-BU4IIOC — Branch: main
- **Tóm tắt:** Thiết lập quy trình đồng bộ lịch sử push code và rule tự động cho AI khi làm việc trên 2 máy.
- **Thay đổi chính:**
  - `PUSH_LOG.md`: Tạo file nhật ký tóm tắt mỗi lượt đẩy code (mới nhất ở trên cùng).
  - `.agents/rules/push-sync-log.md`: Tạo workspace rule (`always_on`) nhắc AI đọc `PUSH_LOG.md` khi pull/bắt đầu phiên, bắt buộc cập nhật `PUSH_LOG.md` trước khi `git push`, và tự tạo global rule trên máy còn lại nếu chưa có.
  - Global rule trên máy `DESKTOP-BU4IIOC` (`~/.gemini/config/rules/push-sync-log.md`): Đã được thêm đồng bộ.
- **Kiểm tra:** Đã kiểm tra `git status` và nội dung các file rule theo đúng chuẩn Antigravity (`trigger: always_on`). Không sửa code app nên không chạy build.
- **Bàn giao / Tiếp theo:** Khi máy kia `git pull` về, AI bên máy kia sẽ tự động đọc `.agents/rules/push-sync-log.md` và tạo global rule tương ứng tại `~/.gemini/config/rules/push-sync-log.md`. (Commit nền trước đó trên repo: `345b127`).
