# ShadowLab — Shadowing & Dictation

Bản web luyện tiếng Anh theo câu, có giao diện tiếng Việt và sẵn cấu trúc triển khai lên Vercel. Dán văn bản/phụ đề để tạo bài, luyện Listen → Dictation → Shadowing → Review, lưu tiến độ trên trình duyệt và chủ động xuất/mở tệp bài học.

Không cần tài khoản trong app, cơ sở dữ liệu, API key hoặc bước build JavaScript. Tạo giọng UK dùng `edge-tts` qua Python Function; nhận diện lời nói dùng dịch vụ Web Speech của trình duyệt.

## Xuất bản trên Vercel

1. Giải nén và đưa **nội dung bên trong** thư mục `Shadow-Dictation-Vercel` lên một GitHub repository. Ở gốc repository phải có `vercel.json`, `requirements.txt`, thư mục `api` và thư mục `public`.
2. Trong Vercel, chọn **Add New → Project**, nhập repository đó.
3. Chọn **Framework Preset: Other**. Root Directory là thư mục chứa `vercel.json`. Nếu repository chỉ chứa app này, giữ gốc repository.
4. Dùng cấu hình trong `vercel.json`: không có Build Command; Output Directory là `public`. Không đặt Root Directory thành `public`, vì Vercel cần thấy `api/tts.py` và `requirements.txt` để triển khai API.
5. Nhấn **Deploy**. Không cần điền Environment Variables. Mở địa chỉ HTTPS mà Vercel cấp.
6. Bấm **Thử hội thoại mẫu → Nghe câu**, rồi thử **Ghi âm** và cấp quyền microphone. Trong phần tùy chỉnh có **MP3 toàn bài**. Có thể mở `examples/Tea-at-the-cafe.shadow.json` để thử audio đã được tạo sẵn.

Nếu dùng Vercel CLI, chạy `vercel` từ thư mục gốc app, kiểm tra bản Preview rồi chạy `vercel --prod` khi muốn xuất bản. Các lệnh này dùng tài khoản Vercel của bạn.

`GET /api/tts` kiểm tra Function đã hoạt động và liệt kê giọng đọc. Để kiểm tra dịch vụ tạo audio thật, phải phát một câu hoặc gửi POST. GET thành công chưa xác nhận Microsoft đang trả audio.

## Chức năng

| Phần | Cách hoạt động |
| --- | --- |
| Tạo bài | Dán văn bản, hội thoại, phụ đề; nhập TXT/SRT/VTT; nhận nhãn người nói và timestamp đã sao chép. Xem trước, sửa, gộp cùng vai hoặc xóa câu trước khi tạo. |
| Chia đoạn | Theo dấu câu, lượt hội thoại, ranh giới mệnh đề và giới hạn 20/32/45 từ. Thời lượng khoảng 8/13/18 giây là ước lượng từ tốc độ nói 2,5 từ/giây. |
| Listen | Phát một câu hoặc toàn bài, tua trong câu, điều chỉnh tốc độ 0,5–2×, lặp, bật/ẩn phụ đề, thêm bản dịch thủ công, nhấn từ để nghe lại. |
| Dictation | Full dictation hoặc Fill in the blanks. Chấm từng từ, đánh dấu đúng/sai/thiếu/thừa/sai vị trí; có chế độ phân biệt chữ hoa và dấu câu. |
| Gợi ý | Số chữ cái → chữ cái đầu → hiện xen kẽ chữ cái → đáp án. Đáp án có gợi ý không được tính là lượt thành thạo không trợ giúp. |
| Shadowing | Listen & Repeat, Simultaneous, Delayed, Continuous; chỉnh độ trễ và số lần lặp; chọn một vai để app đọc các vai còn lại. |
| Ghi âm | Ghi thủ công hoặc tự động trong lượt luyện, nghe lại, tải bản ghi, tự dừng sau khoảng 2,3 giây im lặng khi đã có tiếng nói; tối đa 90 giây mỗi lượt. |
| Đối chiếu lời nói | Hiển thị bản chép nhận diện en-GB, so với câu gốc theo từng từ; có thể sửa bản chép rồi kiểm tra lại. Các dạng rút gọn thông dụng được chuẩn hóa riêng cho lời nói. |
| Review | Tổng hợp từ sai và câu khó, lưu số lần sai, đánh dấu đã nhớ, gắn sao và ghi chú. Ôn lại lỗi mới và câu đến hạn. |
| Tệp bài | Xuất `.shadow.json`, gồm câu gốc, vai, bản dịch, bản nháp, lịch sử, các số đếm, ghi chú và tiến độ. Có thể kèm audio đã tạo, file nguồn và bản ghi hiện có. Mở tệp trên máy khác để học tiếp. |
| MP3 | Tải MP3 một câu hoặc ghép MP3 toàn bài bằng giọng UK tương ứng với từng vai. MP3 xuất ở tốc độ gốc; thanh tốc độ chỉ thay đổi lúc nghe trong app. |

Bốn giọng UK: **Sonia, Ryan, Libby, Thomas**. Có giọng mặc định và giọng riêng cho từng người trong hội thoại.

## Cách tạo và học một bài

Ví dụ văn bản hội thoại, mỗi lượt một dòng:

```text
Alice: Good morning. Could I have a cup of tea, please?
Ryan: Of course. Would you like anything to eat?
Alice: Yes, a sandwich would be lovely.
```

1. **Tạo bài** → đặt tên → dán/nhập nội dung → **Phân tích & chia câu**. Kiểm tra tên người nói và nội dung. Hai câu khác vai được giữ riêng.
2. **Listen**: nghe toàn bài để hiểu tình huống. Bật phụ đề/bản dịch nếu cần. Bản dịch do bạn thêm trong **Sửa câu**, app không tự dịch.
3. **Dictation**: nghe từng câu và nhập câu trả lời. Bấm **Kiểm tra**, sau đó nhấn từ gốc bị đánh dấu để nghe lại. Dùng **Làm lại** để xóa bản nháp và bắt đầu lượt mới. Trong dictation, bật phụ đề sẽ hiện đáp án và được tính là gợi ý.
4. **Shadowing**: bắt đầu bằng Listen & Repeat, rồi chuyển sang Simultaneous/Delayed. Bật tự ghi âm để lưu lượt nói; dùng tai nghe khi vừa phát mẫu vừa ghi âm.
5. **Review**: luyện các từ sai, câu gắn sao và câu đến hạn. Một lỗi được đánh dấu đã giải quyết sau hai lượt đúng không gợi ý; lỗi lặp lại sẽ quay vào danh sách. Có thể tự chọn **Đã nhớ**.
6. Trước khi đóng trang, chọn **Lưu file bài**, bật **Kèm audio** và xuất tệp. Hôm sau chọn **Mở bài** và mở tệp đó. Sau khi học tiếp, xuất một phiên bản tệp mới để giữ tiến độ mới nhất.

Câu được tính hoàn tất sau một lượt dictation 100% không gợi ý và một lượt đối chiếu lời nói đạt ít nhất 90%. Kết quả này thể hiện mức khớp văn bản. Lịch ôn câu tăng 1 → 2 → 4 → 8 → 16 → 30 ngày sau các lượt hoàn hảo không gợi ý; lượt chưa hoàn hảo đặt lịch ngày hôm sau. Câu có lỗi chưa giải quyết hoặc gắn sao vẫn xuất hiện trong Review. Lịch sử gần nhất giữ tối đa 20 lượt mỗi chế độ; tổng số lượt và mốc hoàn tất vẫn được giữ.

Phím tắt: **Alt + ← / →** chuyển câu; **Alt + P** nghe câu; **Ctrl/⌘ + Enter** kiểm tra dictation. App không chặn các phím gõ thông thường trong ô nhập.

## Đồng bộ audio và phụ đề

**Giọng UK tạo từ văn bản:** API trả MP3 và metadata WordBoundary. App dùng mốc này để tô sáng và phát lại từ trong câu. Nếu một từ không ghép được metadata, app đánh dấu dữ liệu đó là ước lượng và phát lại câu thay cho một mốc từ giả định.

**Audio/video của bạn:** tạo bài từ SRT/VTT, mở **Tùy chỉnh luyện & nguồn âm thanh → Chọn audio/video gốc**. App phát đúng khoảng đầu–cuối của câu và tự dừng. Chọn nguồn giọng UK khi muốn quay về TTS.

- File phụ đề chỉ cung cấp mốc câu/cue. Không có mô hình forced alignment để tìm chính xác thời điểm từng từ trong file nguồn. Nhấn từ sẽ phát lại câu chứa từ đó.
- Nếu một cue có nhiều câu/người nói, app phân bổ thời gian theo độ dài và ghi **Mốc ước lượng**. Timestamp chỉ có thời gian bắt đầu cũng được ghi ước lượng. Dùng **Sửa câu** để chỉnh đầu/cuối theo file thực tế.
- Văn bản không có timestamp sẽ dùng TTS ngay. Nếu gắn file gốc, bạn cần thêm mốc đầu/cuối cho câu muốn nghe bằng nguồn đó.
- Không tự tải video/audio từ URL YouTube. Bạn chủ động dán phụ đề hoặc chọn file media có trên máy.

Phân đoạn mệnh đề và gợi ý loại lỗi là quy tắc trong app, không phải phân tích ngữ nghĩa/ngữ pháp bằng mô hình AI. Nhãn chính tả, dạng động từ, đuôi -s và giới từ giúp định hướng kiểm tra, không thay thế giải thích ngữ pháp theo ngữ cảnh.

## Dữ liệu lưu ở đâu?

| Dữ liệu | Lưu tự động trong localStorage | Xuất tệp bài |
| --- | --- | --- |
| Văn bản, người nói, bản dịch, thiết lập, vị trí đang học | Có | Có |
| Bản nháp, transcript nhận diện, điểm, số lần nghe/gợi ý/làm lại | Có | Có |
| Từ sai, câu gắn sao, ghi chú, lịch ôn | Có | Có |
| MP3 tạo sẵn, file audio/video nguồn, bản ghi microphone | Không | Có, khi bật kèm audio và dữ liệu đang có trong phiên |

Audio/bản ghi nằm trong phiên đang mở. localStorage không chứa các chuỗi audio lớn. **Chuẩn bị audio** tạo sẵn TTS cho các câu; sau đó xuất kèm audio để giữ chúng. Tệp chỉ kèm các audio đã có, không tự tạo phần chưa nghe trong lúc xuất.

Để nghe mà không gọi dịch vụ TTS, mở trang app rồi nhập tệp có kèm audio tương ứng. Nếu mất Internet trong trang đã mở, những audio đó vẫn phát được. Bản này không cài Service Worker nên không bảo đảm tải lại toàn bộ trang web khi hoàn toàn mất mạng. Nhận diện giọng nói thường vẫn cần Internet.

Khi mở tệp trùng ID bài hiện có, app hỏi trước khi thay phiên bản cục bộ bằng dữ liệu trong tệp. Nhập tệp sai định dạng không xóa bài đang học. Nếu localStorage bị chặn, đầy hoặc chứa dữ liệu lỗi, app báo rõ và vẫn cho xuất bài thành tệp. Xóa bài khỏi danh sách không xóa các tệp bạn đã tải xuống. Không có đồng bộ tài khoản hoặc tự ghi đè tệp trên máy.

Ứng dụng không có cơ sở dữ liệu bài học trên server. Văn bản cần tạo giọng được gửi đến API rồi dịch vụ Microsoft. Web Speech có thể gửi audio đến dịch vụ nhận diện của trình duyệt; cấp quyền microphone chỉ khi bạn muốn ghi âm/nhận diện.

## Nhận diện lời nói và phát âm

Điểm shadowing là **mức khớp bản chép lời nói với câu gốc**. Các từ thiếu/thay thế có thể do cách nói hoặc lỗi nhận diện, tiếng ồn, microphone. App không đo âm vị, trọng âm hay ngữ điệu và không khẳng định một từ được phát âm sai chỉ từ transcript.

Web Speech có mức hỗ trợ khác nhau giữa các trình duyệt. Nếu không nhận diện được, app vẫn giữ bản ghi để nghe lại; bạn có thể nhập/chỉnh bản chép thủ công và đối chiếu. Khi dừng ghi, app chờ kết quả nhận diện cuối tối đa 2,5 giây. Ghi âm cần HTTPS hoặc localhost và quyền microphone. Bản ghi xuất theo định dạng mà trình duyệt hỗ trợ: WebM/Opus, M4A hoặc OGG; đây là tệp ghi âm, MP3 giọng UK có nút tải riêng.

## Giới hạn chủ động

- 30.000 ký tự văn bản / 400 đoạn luyện mỗi bài; tối đa 1.200 ký tự và 180 từ một câu.
- File audio/video nguồn tối đa 45 MiB; tệp bài import/export tối đa khoảng 90 MB, tính cả base64.
- Dữ liệu localStorage của toàn danh sách được giới hạn 2,5 triệu ký tự để tránh vượt quota phổ biến. Khi đạt giới hạn, xuất bài rồi xóa bớt bài cục bộ.
- API nhận tối đa 32 KB JSON, tạo audio cho 1 câu mỗi request, có thời gian chờ 50 giây và giới hạn audio 2,5 MB. Client có hủy tác vụ và thử lại một lần với lỗi dịch vụ 502/503/504.
- Dịch vụ Edge TTS và Web Speech phụ thuộc bên ngoài. `edge-tts` được ghim phiên bản 7.2.8 đã kiểm tra; thay đổi dịch vụ sau này có thể cần cập nhật dependency. App hiển thị lỗi và giữ dữ liệu học, không tạo audio/điểm thay thế giả.

## Chạy và kiểm tra trên máy

Cần Python 3.12 và Internet để tạo TTS mới:

```sh
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python dev.py
```

Mở `http://127.0.0.1:8000`. Không mở `index.html` bằng `file://`, vì app cần API cùng nguồn.

Kiểm tra logic và API (Node.js 22+ cho test JavaScript):

```sh
node --test tests/core.test.mjs
python -m unittest discover -s tests -v
```

Kiểm tra giao diện tự động cần Playwright, chỉ dùng khi phát triển, không cần khi deploy:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/browser.mjs
```

Script tự khởi động server test trên localhost, áp dụng CSP từ `vercel.json`, dùng MP3 thực trong fixture và microphone tổng hợp. API TTS trong test UI và nhận diện giọng nói được mô phỏng để kiểm tra luồng ổn định. Test này không đo độ chính xác ASR ngoài đời. Kết quả và ảnh chụp được ghi vào `test-output/`. Có thể đặt `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_MODULE` và `TEST_OUTPUT_DIR` để dùng trình duyệt/module/thư mục kết quả khác.

Xem `CHECKS.md` và thư mục `docs/` để biết kết quả kiểm tra bản giao này. Chưa triển khai lên tài khoản Vercel của bạn và chưa thử microphone/ASR trên điện thoại vật lý.

## Khi gặp lỗi

| Hiện tượng | Việc cần kiểm tra |
| --- | --- |
| Trang trắng hoặc JS không chạy | Deploy cả dự án; Root Directory trỏ đúng gốc app; dùng URL web/localhost và bật JavaScript. |
| API 404 | Repository có `api/tts.py` và `requirements.txt` ở đúng gốc; không deploy riêng `public`. |
| API 502/503/504 | Thử câu ngắn và thử lại; xem Vercel Function Logs. Có thể mở bài kèm MP3 đã xuất để tiếp tục học. |
| Không phát được file nguồn | Dùng định dạng mà trình duyệt hỗ trợ, kiểm tra mốc đầu/cuối và chọn lại file sau khi tải lại trang. |
| Không ghi âm được | Dùng HTTPS/localhost, kiểm tra quyền microphone của trang và của hệ điều hành. |
| Có bản ghi nhưng không có transcript | Dịch vụ nhận diện có thể không được hỗ trợ hoặc không kết nối; nghe bản ghi và nhập/chỉnh bản chép. |
| Tiến độ chưa lưu tự động | Bấm Lưu file bài để giữ dữ liệu hiện tại; kiểm tra quyền lưu cục bộ/quota. Dữ liệu cũ bị lỗi được giữ để tránh ghi đè âm thầm. |

## Cấu trúc và tham khảo

`public/core.mjs`: phân đoạn, chấm từng từ, tiến độ, định dạng tệp. `store.mjs`: localStorage. `audio.mjs`: TTS, metadata, phát đoạn và MP3. `capture.mjs`: ghi âm/nhận diện/tự dừng. `app.mjs`: giao diện và luồng học. `api/tts.py`: Python Function tạo MP3 và mốc từ. `tests/`: các kiểm tra có thể chạy lại.

Thiết kế đã tham khảo quy trình nghe–chép–kiểm tra–đọc của [Daily Dictation](https://dailydictation.com/), bài dictation/ghi âm và lịch sử phản hồi trong [Speechling Help](https://speechling.com/help/quickstart/), cùng cách phát lại ngữ cảnh và thay đổi tốc độ trong [YouGlish](https://youglish.com/). App kết hợp các hành vi đó với bài do người học tự nhập, chọn vai và tệp học có thể mang theo. Không sao chép bài học hoặc tài sản của các dịch vụ này.

Tài liệu kỹ thuật: [Vercel Python Functions trong /api](https://vercel.com/docs/functions/runtimes/python/api-directory), [Vercel Project Configuration](https://vercel.com/docs/project-configuration), [edge-tts](https://github.com/rany2/edge-tts), [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Tham khảo và kiểm tra ngày 09/10/2026.
