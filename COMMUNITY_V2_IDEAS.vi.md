# Cộng đồng và tra cứu cấu hình game — bản triển khai đầu

Ngày cập nhật: 25/11/2026.

Tài liệu tiếng Việt này dành cho bạn đọc. File triển khai riêng là `COMMUNITY_IMPLEMENTATION.md`, viết bằng tiếng Anh. Trong quá trình làm, AI không đọc lại tài liệu ý tưởng này.

## 1. Trải nghiệm mình chọn

Mục Cộng đồng có ba khu vực: **Bảng tin**, **Khám phá**, **Hồ sơ**.

- Bảng tin: đăng ảnh game, cảm nhận, câu hỏi; thả tim và bình luận.
- Khám phá: tìm game, đọc đánh giá, xem cấu hình Steam và kết quả chơi thực tế.
- Hồ sơ: những gì một người chủ động công khai, gồm bài viết, đánh giá và thống kê chơi.

Cộng đồng mở công khai từ đầu. Người nhận link có thể xem bài hoặc trang game trên web; đăng nhập Google khi muốn tương tác.

## 2. Tìm game rồi biết máy mình có chơi được không

Ví dụ bạn tìm một game trong Khám phá. Trang game sẽ có:

1. Poster, tên game và đường dẫn Steam nếu xác định được đúng game.
2. **Yêu cầu tối thiểu** và **cấu hình đề nghị** do Steam cung cấp.
3. **Máy người chơi thực tế**: các cấu hình đã được người chơi chia sẻ sau khi đánh dấu hoàn thành game.
4. Đánh giá, bài viết, screenshot và hành động thêm vào Chờ chơi.

Steam không công bố một mức FPS bảo đảm cho mọi cấu hình. Vì vậy thông số chính thức và trải nghiệm thực tế sẽ đứng cạnh nhau nhưng được ghi nguồn riêng.

Nếu Steam không có cấu hình đề nghị, trang ghi rõ chưa có thông tin. Game ngoài Steam vẫn có trang cộng đồng nhưng không gán cấu hình Steam của một game tên gần giống.

## 3. Một kết quả chơi thực tế nên hiển thị gì?

| Thông tin | Ý nghĩa |
|---|---|
| Người chia sẻ | Có thể mở hồ sơ và xem đánh giá |
| Trạng thái hoàn thành | Người chơi tự xác nhận đã hoàn thành |
| CPU, GPU, RAM | Cấu hình gắn với lần chơi/đo đó |
| FPS trung bình | Giá trị đo được hoặc người dùng tự nhập, có nhãn phân biệt |
| Độ phân giải game | Ví dụ 1920 × 1080; không lấy độ phân giải màn hình làm kết luận |
| Thiết lập đồ họa | Low/Medium/High/Ultra hoặc Custom |
| Nâng độ phân giải, tạo khung hình | DLSS/FSR/XeSS và Frame Generation nếu người chơi cung cấp |
| Ngày đo và số mẫu | Giúp biết kết quả còn phù hợp không |

Người xem có thể lọc GPU, độ phân giải và mức đồ họa. Không gộp FPS của nhiều máy thành một con số bảo đảm.

Cùng một GPU nhưng khác độ phân giải, thiết lập và phiên bản game có thể cho kết quả rất khác nhau. Dữ liệu để tham khảo, không phải cam kết máy bạn sẽ chạy đúng số FPS đó.

## 4. Chia sẻ kết quả sau khi phá đảo

Trong trang game riêng của người dùng sẽ có phần cấu hình/hiệu năng:

- Xác nhận độ phân giải và thiết lập đang dùng.
- Xem những phiên đã đo FPS bằng hệ đo hiện có.
- Chọn một phiên phù hợp, kiểm tra cấu hình và xem trước nội dung.
- Khi game đã đánh dấu hoàn thành, bấm chia sẻ kết quả ra cộng đồng.

Không tự công khai toàn bộ thông số máy hoặc giờ chơi chỉ vì người dùng đồng bộ thư viện.

Nếu phiên chơi cũ chưa lưu cấu hình và độ phân giải, app không giả định máy hiện tại là máy đã dùng trước đây. Người dùng có thể bổ sung thông tin với nhãn tự khai báo hoặc đo lại ở phiên mới.

## 5. Tự xuất file setting của mọi game có khả thi không?

**Làm cho một danh sách game được hỗ trợ là khả thi. Tự nhận diện chính xác cho mọi game trên thế giới thì không thể bảo đảm.**

Mỗi game có cách lưu setting khác nhau:

- INI, JSON, XML hoặc file nhị phân riêng.
- Có game lưu vào thư mục người dùng, thư mục cài đặt hoặc registry.
- Có game trộn setting với tài khoản, save hoặc dữ liệu launcher.
- Một bản cập nhật có thể đổi tên hoặc vị trí file.

Hướng mình chọn là hệ thống bộ nhận diện theo game, thêm dần theo nhu cầu thực tế. Game được hỗ trợ có nút phát hiện tự động. Game chưa hỗ trợ cho người dùng chọn file setting thủ công.

App hiển thị file tìm được và cho người dùng chọn nơi xuất. Xuất tại máy, không sửa setting gốc, không tự áp dụng setting người khác và không đưa nguyên file lên mạng.

## 6. Hai kiểu chia sẻ cần tách riêng

**Chia sẻ cấu hình để tham khảo:** chỉ gồm các trường đồ họa và kết quả đo được chọn. Người khác thấy bạn dùng độ phân giải/mức đồ họa nào.

**Xuất file setting để giữ bản sao:** tạo gói file tại máy. File thô có thể chứa thông tin riêng hoặc không phù hợp phiên bản game của người khác; người dùng tự quyết định chuyển file này cho ai.

Bản đầu ưu tiên thông tin đồ họa và xuất bản sao local. Kho tải setting công khai và tự áp dụng setting cần được cân nhắc riêng sau này.

## 7. Phần cộng đồng vẫn được làm cùng

- Bài gắn game, tối đa ba ảnh được người dùng chọn.
- Thả tim, bình luận, lưu bài và thông báo tương tác.
- Review theo từng game; mỗi người có một review chính có thể cập nhật.
- Hồ sơ công khai với lựa chọn chia sẻ rõ ràng.
- BXH game nhiều người chơi, tổng giờ chơi được chia sẻ và điểm cao.
- Báo cáo, chặn tài khoản và công cụ quản trị xử lý nội dung.
- Giữ hoạt động bình chọn game cộng đồng theo tháng.

BXH giờ chơi cá nhân là góc tham khảo; không coi người chơi nhiều giờ nhất là người giỏi nhất. BXH tuần/tháng chỉ xuất hiện khi có dữ liệu chơi theo thời gian đủ tin cậy.

## 8. Ví dụ vòng trải nghiệm

Bạn thấy ảnh đẹp của một game → mở trang game → đọc review và cấu hình Steam → tìm người dùng GPU gần giống máy mình → xem FPS/độ phân giải/setting của họ → thêm game vào Chờ chơi.

Sau khi chơi, bạn chọn screenshot hoặc chia sẻ kết quả của chính mình. Người tiếp theo lại dùng trải nghiệm đó để quyết định.

## 9. Các điều sẽ hiển thị trung thực

- Chưa có người chia sẻ kết quả: hiển thị trạng thái trống, không tạo benchmark mẫu như dữ liệu thật.
- Không đo được FPS: ghi chưa có số đo.
- Chưa biết độ phân giải: yêu cầu xác nhận, không đoán.
- Game chưa được hỗ trợ tự tìm setting: báo chưa hỗ trợ và cho chọn file thủ công.
- Steam không phản hồi: có thông báo và thao tác thử lại.
- Cộng đồng công khai không đồng nghĩa với công khai Gmail, ghi chú riêng, save hoặc toàn bộ ảnh backup.

Đích đến là một trang game giúp người chơi biết game có đáng chơi, cộng đồng nghĩ gì và những máy thực tế đã chạy nó ra sao.
