# Kiểm tra bản cập nhật — 09/10/2026

**90 kiểm tra tự động đạt:** 43 kiểm tra logic/đồng bộ/audio, 7 kiểm tra API, 29 kịch bản hồi quy trình duyệt và 11 kịch bản nâng cấp. Ngoài ra đã kiểm tra dịch vụ giọng thật với cả bốn giọng UK và ghi/đọc bài cùng MP3 trên Firebase project được cung cấp. Kết quả chi tiết ở `docs/check-results.json`.

## Dữ liệu và đồng bộ

Kiểm tra cũ vẫn bao gồm phân đoạn TXT/SRT/VTT, tên người nói, mốc câu, chữ viết tắt, số thập phân, từ đúng/sai/thiếu/thừa/sai vị trí, strict mode, ASR contractions, gợi ý, Review, tiến độ và tệp không hợp lệ.

Kiểm tra mới bao gồm:

- Thiết đặt narrator/nhân vật, thống kê số câu/từ, dữ liệu cũ và tệp bài giữ giọng/tốc độ/cao độ/ghi chú.
- Đoạn văn gom một yêu cầu; hội thoại giữ chuyển giọng; nhóm dài tuân thủ giới hạn API.
- Tốc độ nghe không đổi cache MP3; đổi tốc độ/cao độ tạo giọng đổi cache.
- Phân tích frame MP3 thật, giảm phần im lặng cuối và ghép không cắt ngang frame; ranh giới câu/từ trong file toàn bài và round trip `.shadow.json`.
- Liên kết riêng ổn định, cùng liên kết trên thiết bị mới và vùng dữ liệu tách biệt.
- AES-GCM: giải mã đúng; từ chối thay đổi ciphertext, sai khóa và sai ngữ cảnh. Chia Unicode không làm hỏng emoji; mỗi phần dưới giới hạn kích thước Firestore.
- Ghi/đọc bài, ghi chú, nháp, giọng và audio qua transport mô phỏng; dữ liệu trên máy chủ chỉ có ciphertext.
- Mất mạng rồi mở lại; hàng đợi giữ qua reload; sửa lúc đang gửi không mất lượt sửa mới.
- Hai thiết bị sửa cùng phiên bản: báo xung đột, giữ được lựa chọn máy này/Firebase. Phản hồi ghi bị mất được phục hồi, không hiểu nhầm là sửa từ thiết bị khác.
- Xóa bài đồng bộ bằng tombstone. Tiến độ vẫn giữ tham chiếu audio Firebase khi thiết bị chưa tải media.
- Firestore REST: phân trang, ánh xạ dữ liệu, phân biệt tệp thiếu/quyền bị từ chối và dùng `updateTime`/`exists` ở máy chủ để chống ghi đè phiên bản.

## Trình duyệt

Playwright 1.62.1, Chromium headless; giao diện dùng CSP từ `vercel.json`. Fixture là MP3 thật. API TTS và ASR được mô phỏng trong kiểm tra UI; microphone là thiết bị tổng hợp/WebAudio, ghi âm bằng MediaRecorder thật.

29 kịch bản hồi quy gồm tạo/sửa/chia/gộp bài, phụ đề và nghe từ, dictation/full/blanks/gợi ý, ghi âm/tải bản ghi, kết quả ASR trả muộn, bốn chế độ shadowing, hủy luồng và nhả microphone, tự dừng vì im lặng, Review, ghi chú, xuất/mở bài, audio/video gốc, mốc sai, lưu cục bộ bị chặn/hỏng và viewport mobile.

11 kịch bản nâng cấp gồm tự tải trước cả đoạn bằng một request, phát toàn bài bằng một URL audio và phụ đề đổi câu, đổi tốc độ khi phát, lưu/chọn lại bài, mở bài trên browser context độc lập và khôi phục giọng/ghi chú/speed/audio, Text → MP3/history/download, đồng bộ lịch sử, chuyển MP3 thành bài học, bố cục một viewport, dữ liệu mã hóa, ôn/chuyển bài khi offline, hủy chuyển đổi đang chờ khi tạo bài khác và liên kết đồng bộ lỗi vẫn mở được app.

Không có lỗi JavaScript chưa được xử lý trong các lần chạy cuối. Ảnh desktop/mobile đã được xem lại ở `docs/`. FFprobe đọc MP3 tải xuống, FFmpeg giải mã tới hết mà không báo lỗi.

## Dịch vụ thực

- `edge-tts==7.2.8` tạo MP3 và WordBoundary thật cho Sonia, Ryan, Libby, Thomas, với rate −10% và pitch +5 Hz. Cả bốn trả audio và 10 mốc từ. Có thêm mẫu Sonia/Ryan với thông số khác để kiểm tra luồng ghép. Xem `docs/voices-report.json`.
- Firestore project `shadow-study-mindlab`: ghi bài được mã hóa, ghi phần MP3, đọc lại từ cache độc lập, giữ thiết đặt giọng và thay đổi phiên bản bằng điều kiện ở máy chủ. Dữ liệu thử thuộc vùng ngẫu nhiên riêng và đã xóa khi hoàn tất. Xem `docs/firebase-live-report.json`.
- Kiểm tra Firebase thật cố ý chặn WebChannel để kiểm tra đường REST dự phòng. Browser trong môi trường QA dùng relay Python xác minh TLS để truy cập máy chủ thật; relay và tùy chọn mạng này chỉ có trong test, không trong app. Luồng SDK WebChannel trên mạng người dùng không được tuyên bố đã kiểm tra thực tế.
- `vercel.json` hợp lệ theo schema chính thức hiện tại. Python runtime 3.12, Function ở `/api`, frontend static ở `public`.

## Phạm vi còn phụ thuộc môi trường triển khai

Chưa triển khai bản cập nhật vào tài khoản Vercel, chưa publish rules vào Firebase Console. Rules được đính kèm để chủ dự án áp dụng. Chưa thử ASR bằng giọng người thật hoặc trên iOS/Android vật lý; viewport mobile kiểm tra bố cục. Dịch vụ TTS/ASR, quota Firebase và quyền microphone phụ thuộc mạng, trình duyệt và dịch vụ ở thời điểm sử dụng.

App giữ cache/hàng đợi, cho xuất bài và xử lý lỗi rõ ràng. Khi nhận diện không hoạt động, vẫn ghi âm/nghe lại và nhập bản chép để luyện.

## Chạy lại

```sh
node --test tests/core.test.mjs tests/sync-audio.test.mjs
python -m unittest discover -s tests -p "test_*.py" -v
node tests/browser.mjs
node tests/upgrade-browser.mjs
```

Kiểm tra Firebase thật chủ động: `node tests/firebase-live.mjs`. Dependency và cấu hình Playwright nằm trong `README.md`; tests được loại khỏi Function triển khai.
