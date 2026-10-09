# Kiểm tra bản giao — 09/10/2026

**62 kiểm tra tự động đạt:** 26 kiểm tra logic, 7 kiểm tra API và 29 kịch bản giao diện. Ngoài ra đã gọi dịch vụ TTS thực tế với cả bốn giọng UK và tạo bài mẫu có MP3 thật. Chi tiết nằm trong `docs/` và mã kiểm tra nằm trong `tests/`.

## Logic và dữ liệu

Node test runner kiểm tra phân đoạn dấu câu/mệnh đề, tên người nói, chữ viết tắt, số thập phân, phụ đề nhiều dòng, SRT/VTT nhiều vai trong một cue, timestamp sao chép, giới hạn độ dài và dữ liệu không hợp lệ.

Chấm từ được kiểm tra cho chế độ nghiêm ngặt/thông thường, thiếu/thừa/thay thế/đảo vị trí, dạng rút gọn của ASR, gợi ý loại lỗi, vị trí từ gốc sau chuẩn hóa, các mức gợi ý và các từ bị ẩn.

Kiểm tra lưu/đọc tệp gồm vai, ghi chú, nháp, số đếm, MP3, nguồn video, bản ghi Opus; từ chối sai phiên bản, ID trùng và MIME không phù hợp. Kiểm tra tiến độ không mất khi lịch sử bị giới hạn 20 lượt; câu trả lời có gợi ý không giải quyết lỗi; lỗi thừa từ vẫn được ôn lại; localStorage lỗi/quota không ghi đè dữ liệu cũ.

## API

7 bài unittest dùng HTTP server thật và mô phỏng upstream TTS để kiểm tra transport/validation/status:

- JSON/base64 MP3 và mốc từ; MP3 raw vẫn tải được; cả bốn tên giọng được chấp nhận.
- Giới hạn request, Content-Type, độ dài/thiết lập không hợp lệ.
- Timeout và lỗi upstream trả lỗi tương ứng, không trả audio giả.
- GET readiness không thay cho kiểm tra tạo audio.

## Giao diện trình duyệt

Chạy bằng Playwright 1.62.1 trên Chromium headless, với CSP lấy từ cấu hình Vercel. Trong bài UI, API dùng một fixture MP3 thực; transcript ASR là mô phỏng. Microphone là thiết bị tổng hợp và WebAudio stream, ghi ra tệp bằng MediaRecorder thật.

Các kịch bản gồm:

- Tạo bài, xem trước/gộp cùng vai, ngăn gộp khác vai, chọn giọng từng người.
- Phát/tạm dừng/tua, phụ đề bám mốc WordBoundary và nghe lại từ.
- Dictation, bốn gợi ý, strict mode, điền từ, thử lại và lưu các số đếm.
- Ghi âm, chấm transcript, tải bản ghi, nhận diện trả kết quả cuối muộn.
- Bốn chế độ shadowing chạy đến hết; hủy khi chuyển câu/dừng; nhả microphone và không treo promise.
- Tự dừng ghi âm sau tín hiệu có âm thanh rồi chuyển sang im lặng.
- Review, câu khó, ghi chú, từ sai, xuất toàn bộ dữ liệu hiện có.
- Tải MP3 toàn bài, ghép các câu; FFprobe xác nhận MP3 24 kHz mono, thời lượng 7,392 giây cho fixture hai đoạn.
- Mở tệp trong một browser context mới, phát audio đã lưu mà không gọi API, khôi phục bản ghi; tải lại trang giữ tiến độ qua localStorage.
- Hủy TTS đang chờ khi đổi câu; đồng bộ SRT với MP3 gốc và MP4 video; dừng ở mốc cuối, nghe lại cue khi chưa có mốc từng từ.
- Từ chối mốc thời gian đảo ngược và tệp bài lỗi, giữ bài đang học.
- Giao diện desktop 1365 px/mobile 390 px không tràn ngang; ảnh đã được xem lại.
- ASR không hỗ trợ vẫn ghi âm; từ chối quyền microphone có thông báo; localStorage bị chặn vẫn xuất bài được; dữ liệu cục bộ hỏng được giữ nguyên.

Không phát sinh lỗi JavaScript không được xử lý trong lần chạy cuối.

## Dịch vụ TTS thực

Đã gọi `edge-tts==7.2.8` với WordBoundary cho Sonia, Ryan, Libby và Thomas. Cả bốn trả MP3 không rỗng, mốc từ tăng theo thời gian và thời lượng hợp lệ. Xem `docs/voices-report.json`. Bài mẫu `examples/Tea-at-the-cafe.shadow.json` có ba lượt Alice/Ryan, audio tương ứng với đúng văn bản và bản dịch do app này biên soạn; chưa có tiến độ giả định của người học.

## Vercel và phạm vi kiểm tra

`vercel.json` đã qua kiểm tra theo schema chính thức tại `https://openapi.vercel.sh/vercel.json`. Python Function dùng cấu trúc `/api` được tài liệu Vercel hỗ trợ, runtime Python 3.12. Không có bước build frontend hoặc database.

Chưa triển khai trong tài khoản Vercel của người nhận, chưa kiểm tra ASR từ giọng nói người thật hoặc điện thoại iOS/Android vật lý. Test viewport mobile là kiểm tra bố cục, không thay cho thử trên thiết bị thật. Kết quả TTS thực thể hiện dịch vụ hoạt động ở thời điểm kiểm tra; dịch vụ và quyền trình duyệt có thể thay đổi. App có đường xử lý lỗi, ghi âm/nghe lại thủ công và bài xuất có audio để tiếp tục luyện.

## Chạy lại

```sh
node --test tests/core.test.mjs
python -m unittest discover -s tests -v
node tests/browser.mjs
```

Các dependency và hướng dẫn cài Playwright được ghi trong `README.md`. Test browser tự chạy server riêng, không cần chạy `dev.py` cùng lúc. File fixture chỉ dùng cho QA và được loại khỏi gói Function Vercel.
