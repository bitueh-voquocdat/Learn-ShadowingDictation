# Kiểm tra bản cập nhật cuối — 10/10/2026

**71 kiểm tra logic/API đạt: 55 Node + 16 Python.** Dịch vụ dịch thật đã trả bản dịch cho hai câu, một hội thoại và một đoạn dài 1.199 ký tự. Kết quả hiện tại nằm trong `docs/final-check-results.json`, `docs/final-core-tests.txt`, `docs/final-api-tests.txt`, `docs/translation-live-report.json` và `docs/translation-long-live-report.json`.

## Giữ các tính năng và bố cục hiện có

So sánh trực tiếp với ZIP giao diện trước cập nhật:

- Giữ đủ 188 ID điều khiển cũ. Thêm 22 ID cho nút giao diện tối, thiết đặt màu/âm/hiệu ứng và popup dịch toàn bài.
- Các khai báo kích thước, khoảng cách và bố cục trong CSS gốc không đổi. Chỉ thay font, màu và nền; các điều khiển mới nằm trong menu/popup. Trên màn hình 320px, nút đổi giao diện được đưa vào menu để giữ đủ chỗ cho thanh đầu trang.
- 14 tệp xử lý audio, ghi âm, lưu trữ, đồng bộ, Text → MP3, API TTS và cấu hình Firebase không đổi, xác nhận bằng SHA-256.
- 26 phần xuất của `core.mjs` không đổi, gồm chia câu, chấm từ, gợi ý, tiến độ, ôn tập và xuất/mở bài. Chỉ mở rộng `validateLesson` để giữ bản dịch và thiết đặt mới.
- Phiên bản tệp bài vẫn là v2; không cần chuyển dữ liệu hoặc sửa Firestore Rules. Hàng đợi lưu được tách theo ID bài để dịch nền của một bài không hủy lượt tự lưu ghi chú của bài khác.

Chi tiết: `docs/final-feature-preservation.json`. Đây là đối chiếu mã nguồn, không thay cho kiểm tra hình ảnh trên trình duyệt.

## Phần đã chạy kiểm tra trong bản này

55 kiểm tra Node bao gồm các kiểm tra cũ về chia câu, chấm bài, gợi ý, tiến độ, tệp, audio, mã hóa, hàng đợi đồng bộ và Firestore REST. Các kiểm tra mới xác nhận:

- Tạo bản dịch từng câu và toàn đoạn; dịch không thay bản nháp, điểm hoặc tiến độ.
- Giữ bản dịch thủ công, bỏ kết quả cũ khi câu tiếng Anh thay đổi lúc đang dịch, hủy khi thay đối tượng bài; ID của câu và đoạn không xung đột.
- Giữ kết quả từng đợt, xử lý mất mạng/thất bại một phần, thử lại phần thiếu và dùng lại bản dịch đã lưu.
- Lưu/đọc, xuất/mở lại bản dịch và thiết đặt màu/âm/hiệu ứng; bản dịch dài không bị cắt theo giới hạn cũ.
- Tương phản màu chữ/nền trong hai giao diện với nhiều màu tùy chỉnh; làm sạch dữ liệu thiết đặt không hợp lệ.
- Lưu tùy chọn giao diện; các âm đúng/sai/chúc mừng khác nhau; tắt âm khi đang phát mẫu hoặc thu microphone; tắt hiệu ứng và tôn trọng Reduce Motion. Kiểm tra âm và hiệu ứng sử dụng DOM/AudioContext giả lập, không chứng minh âm thanh nghe thực tế trên thiết bị.

16 kiểm tra Python bao gồm 7 kiểm tra API TTS cũ và 9 kiểm tra dịch: giới hạn dữ liệu, cache, kết quả thật từ provider giả lập, lỗi/timeout và kết quả một phần, tách đoạn theo ký tự/byte, đọc hết response streaming và từ chối response quá lớn, phân tích response Google và khóa Cloud Translation tùy chọn.

Kiểm tra kết nối thật bổ sung đã thành công qua Bing: hai câu và một hội thoại (18,23 giây), đoạn dài 1.199 ký tự (13,26 giây). Thời gian và khả năng đáp ứng vẫn phụ thuộc dịch vụ/mạng. Không có bản dịch giả khi dịch vụ lỗi; bài vẫn lưu và có nút thử lại.

Bốn tệp Be Vietnam Pro có đúng độ đậm 400/500/600/700. Đã kiểm tra 122 mã ký tự, gồm các chữ tiếng Việt có dấu và dấu kết hợp: không thiếu glyph. Font được đóng kèm, không phải tải CDN. Toàn bộ module frontend/test qua `node --check`; CSS kiểm tra cấu trúc; cấu hình Vercel có Function dịch tối đa 60 giây, giữ nguyên các security headers.

## Giới hạn kiểm tra trình duyệt của lần cập nhật này

**Chưa chạy được các bộ kiểm tra trình duyệt trong bản này.** Môi trường không có Chromium; tải Chromium qua Playwright thất bại với tệp tải không hợp lệ. Vì vậy chưa xác nhận hình ảnh giao diện tối, vị trí popup/gradient trên thiết bị, âm thanh nghe thật hoặc hoạt động đầu-cuối trên trình duyệt cho bản cập nhật này.

Đã cập nhật fixture của ba bộ kiểm tra trình duyệt cũ cho API dịch và thêm `tests/enhancements-browser.mjs` để kiểm tra các tính năng mới. Chúng qua kiểm tra cú pháp, nhưng không được tính là các kịch bản đã đạt.

`docs/check-results.json`, các báo cáo UI/audio/Firebase cũ và ảnh trong `docs/` thuộc bản giao diện trước cập nhật. Kết quả 118 kiểm tra của bản trước là thông tin lịch sử; không phải kết quả chạy lại giao diện của bản hiện tại. Chưa triển khai bản cập nhật vào tài khoản Vercel, chưa chạy lại Firebase thật hoặc ASR bằng người thật trong lần này. Các module và rules Firebase cũ được giữ nguyên.

## Chạy lại

Sau khi cài dependency trong `README.md`:

```sh
node --test tests/core.test.mjs tests/sync-audio.test.mjs tests/translation.test.mjs tests/experience.test.mjs
python -m unittest discover -s tests -p "test_*.py" -v
node tests/browser.mjs
node tests/upgrade-browser.mjs
node tests/presentation-browser.mjs
node tests/enhancements-browser.mjs
```

Các bộ kiểm tra trình duyệt cần Playwright và Chromium được cài thành công. Chỉ chạy `tests/firebase-live.mjs` khi chủ động muốn kiểm tra ghi/đọc Firebase thật; test tạo vùng dữ liệu thử riêng và xóa sau khi hoàn tất.
