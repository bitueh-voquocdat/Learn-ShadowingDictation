# ShadowLab — luyện nghe, dictation, shadowing và Text → MP3

Bản cập nhật dùng Firebase project `shadow-study-mindlab` theo cấu hình được cung cấp. Không cần tài khoản trong app. Bài học, tiến độ, giọng đọc, ghi chú, âm thanh và lịch sử MP3 được mã hóa trên trình duyệt rồi đồng bộ lên Cloud Firestore. Vẫn có thể xuất/mở `.shadow.json` để sao lưu chủ động.

## Triển khai lên Vercel

1. Giải nén. Đưa **nội dung bên trong** thư mục `Shadow-Dictation-Vercel` lên GitHub. Ở gốc repository phải có `vercel.json`, `requirements.txt`, `api/` và `public/`.
2. Trên Vercel: **Add New → Project → Import** repository. Chọn **Framework Preset: Other**. Root Directory là thư mục chứa `vercel.json`, không chọn `public`.
3. Giữ Build Command trống, Output Directory `public`. Cấu hình đã nằm trong `vercel.json`; không cần build frontend hay điền biến môi trường.
4. Nhấn **Deploy**, mở URL HTTPS. Thử tạo bài hoặc mở `examples/Tea-at-the-cafe.shadow.json` để nghe MP3 mẫu đã có.
5. Trong [Firebase Console của dự án](https://console.firebase.google.com/project/shadow-study-mindlab/firestore/rules), chọn **Firestore Database → Rules**, dán nội dung `firestore.rules` rồi **Publish**. Rules này dành cho app cá nhân này; nếu dự án còn ứng dụng khác, ghép các đường dẫn của ShadowLab vào rules hiện có của bạn.
6. Trong app, bấm trạng thái đồng bộ ở đầu trang → **Sao chép liên kết**. Giữ liên kết để mở cùng dữ liệu trên thiết bị khác.

Firestore của dự án đã được kiểm tra ghi/đọc dữ liệu thử thật. Các bản ghi thử của lần kiểm tra hoàn tất đã được xóa. Chưa triển khai bản cập nhật vào tài khoản Vercel của bạn. Không cần bật Firebase Authentication, Cloud Storage hoặc Analytics để app hoạt động. Nếu cơ sở dữ liệu `(default)` chưa có trên một dự án khác, tạo Cloud Firestore trước khi dùng.

Nếu dùng CLI, chạy `vercel` tại gốc app; kiểm tra Preview rồi dùng `vercel --prod` khi muốn xuất bản. `GET /api/tts` kiểm tra Python Function; để xác nhận dịch vụ giọng đọc, cần phát/tạo MP3 bằng POST.

## Thay đổi trong bản này

| Yêu cầu | Cách sử dụng |
| --- | --- |
| Bỏ thanh bên | Màn hình chọn bài có tìm kiếm và tiến độ. **Đổi bài** tự lưu bài đang học rồi mở danh sách. |
| Tập trung trong một khung hình | Thanh phát và phụ đề ở một vùng; bài tập/phụ đề toàn bài cuộn trong vùng còn lại. Ghi chú và thiết đặt mở trong hộp thoại. Mobile có bố cục riêng. |
| Giọng theo nhân vật/người đọc | **Giọng & thiết đặt** thống kê số câu, số từ của từng người. Chọn Sonia/Ryan/Libby/Thomas, tốc độ tạo giọng từ −50% đến +50%, cao độ từ −50 đến +50 Hz. Đoạn văn có dòng **Người đọc**. |
| Nghe toàn bài tự nhiên hơn | Tự tải trước khi mở bài. Văn bản liên tiếp cùng giọng được tổng hợp chung, thay vì tạo từng câu. Bài dài hơn 5.000 ký tự/850 từ mỗi nhóm được chia thành vài nhóm lớn và ghép thành một MP3. Hội thoại ghép các nhóm giọng đã tải, giảm im lặng cuối nhóm. Khi phát không cần chờ gọi API giữa các câu. |
| Phụ đề theo âm thanh | Toàn bài dùng mốc từ của TTS để đổi câu và tô từ đang đọc. Với file gốc, mốc câu từ phụ đề và vị trí từ ước lượng vẫn được ghi rõ. |
| Đổi tốc độ ngay lúc học | Thanh **0.5×–2×** hoạt động trong Listen, Dictation và Shadowing, không phải tạo lại MP3. Tốc độ/cao độ tạo giọng trong hộp thiết đặt là thông số khác và được ghi vào MP3. |
| Firebase | Tự lưu thiết đặt riêng mỗi bài, bản nháp, ghi chú câu/toàn bài, kết quả, từ cần ôn, audio và bản ghi. Khi mở bài, tải thiết đặt/audio đã lưu. Mất mạng giữ hàng đợi trên máy rồi gửi lại. Sửa cùng bài trên hai thiết bị sẽ yêu cầu chọn phiên bản. |
| Text → MP3 | Tab riêng để dán tiếng Anh, chọn giọng/tốc độ/cao độ, tạo và tải MP3. Lịch sử tự lưu và đồng bộ. Có thể mở lại hoặc **Tạo bài luyện từ đoạn này**. |

## Một bài học

1. **Tạo bài** → nhập tên và văn bản/TXT/SRT/VTT → **Phân tích & chia câu**. Kiểm tra người nói và câu trong bản xem trước. Gộp chỉ những đoạn cùng người nói.
2. **Listen**: nghe toàn bài, nghe từng câu, bật/ẩn phụ đề; nhấn từ để nghe lại trong câu. Bản dịch do bạn nhập trong **Sửa câu**.
3. **Dictation**: Full dictation hoặc Fill in the blanks; kiểm tra từ đúng/sai/thiếu/thừa/sai vị trí. Có chế độ nghiêm ngặt. Gợi ý: số chữ cái → chữ đầu → hiện một phần từ → đáp án. App giữ số lần nghe, gợi ý và làm lại.
4. **Shadowing**: Listen & Repeat, Simultaneous, Delayed hoặc Continuous. Có chọn vai, khoảng chờ, lặp, ghi âm và phát lại. Continuous không chọn vai phát từ câu hiện tại đến hết trên một file; nếu chọn vai, app dành lượt để bạn nói.
5. **Review**: luyện từ sai, câu gắn sao và câu đến hạn; ghi chú từ/nối âm. **Đổi bài** tự lưu; hôm sau mở bài trong danh sách hoặc bằng liên kết riêng.

Nhận diện giọng nói cho biết **bản chép lời nói khớp văn bản gốc đến mức nào**, không đo phát âm từng âm. Có thể sửa bản chép và đối chiếu lại. Dùng tai nghe khi vừa nghe mẫu vừa ghi âm. Khi ASR không được hỗ trợ hoặc không kết nối, vẫn ghi âm, nghe lại và nhập bản chép thủ công. Web Speech có thể gửi audio tới dịch vụ nhận diện của trình duyệt.

Ghi âm tự dừng sau khoảng 2,3 giây im lặng khi đã có tiếng nói; tối đa 90 giây/lượt. Bản ghi Continuous được giữ cho cả lượt; đối chiếu từng câu được thực hiện khi bản chép nằm trong giới hạn xử lý. Với lượt rất dài, dùng luyện từng câu để kiểm tra chi tiết.

Câu hoàn tất sau dictation 100% không gợi ý và đối chiếu lời nói ít nhất 90%. Lịch ôn tăng 1 → 2 → 4 → 8 → 16 → 30 ngày sau lượt hoàn hảo không gợi ý; lượt chưa hoàn hảo hẹn hôm sau. Câu gắn sao/lỗi chưa giải quyết vẫn được đưa vào Review.

## Đồng bộ và sao lưu

- Liên kết có dạng `https://your-app.vercel.app/#sync=…`. Phần sau `#` là khóa riêng, không được gửi trong request trang. App giữ khóa trên trình duyệt và trong URL để tải lại trang không mất liên kết. **Ai có liên kết đều có thể mở dữ liệu**, nên giữ riêng. Không cần đăng nhập.
- Thiết bị mới phải mở **cùng liên kết**, không chỉ mở tên miền trống. Sau đó ứng dụng tải danh sách bài và lịch sử MP3, tải audio khi mở bài.
- Chỉ coi dữ liệu đã gửi xong khi trạng thái hiện **Đã đồng bộ Firebase**. Nếu đóng tab lúc còn chờ, hàng đợi được giữ để gửi khi mở lại. Tránh xóa dữ liệu trình duyệt trước khi đồng bộ hoặc xuất bài.
- localStorage giữ văn bản/tiến độ và hàng đợi; IndexedDB giữ audio để mở nhanh. Nếu trình duyệt chặn lưu cục bộ, giữ liên kết riêng và xuất file bài để có bản sao.
- **Lưu file bài** xuất `.shadow.json`. Chọn kèm audio để giữ MP3, file nguồn và bản ghi. Có thể nhập file bản cũ của ShadowLab. Bản localStorage v2 được chuyển sang vùng đồng bộ riêng khi mở bản cập nhật lần đầu trên cùng origin; nếu đổi tên miền, mở file bài đã xuất để chuyển dữ liệu.
- File bài tối đa khoảng 90 MB; file audio/video gốc tối đa 45 MB. Media được chia nhỏ trong Firestore, không cần Cloud Storage. File lớn đồng bộ lâu hơn và sử dụng nhiều lượt đọc/ghi, dung lượng của Firebase. Xem [giới hạn Firestore](https://firebase.google.com/docs/firestore/quotas).

Rules đính kèm chặn các đường dẫn khác và việc liệt kê toàn bộ vùng người dùng. Dữ liệu học được mã hóa AES-GCM bằng khóa của liên kết. Đây là cơ chế truy cập bằng liên kết cho ứng dụng cá nhân; không thay cho phân quyền bằng tài khoản khi xây ứng dụng nhiều người dùng. API key trong cấu hình web là định danh dự án, không phải mật khẩu quản trị. Không có service-account key trong mã.

SDK Firebase 13.0.0 được đóng kèm để không phụ thuộc tải CDN lúc mở trang. Nếu mạng không duy trì được WebChannel, app dùng Firestore REST với điều kiện phiên bản ở máy chủ và kiểm tra lại khi trang trở lại hoạt động. Dữ liệu đều qua cùng Firestore Rules. Khi dùng dự phòng, thay đổi từ thiết bị khác được kiểm tra khoảng 15 giây/lần; bấm **Đồng bộ ngay** để lấy ngay.

## Chạy tại máy và kiểm tra

Cần Python 3.12. Chạy tại thư mục gốc:

```sh
python -m pip install -r requirements.txt
python dev.py
```

Mở `http://127.0.0.1:8000`. Không mở `index.html` bằng `file://`, vì API/microphone và mã hóa cần HTTPS hoặc localhost.

Kiểm tra logic/API:

```sh
node --test tests/core.test.mjs tests/sync-audio.test.mjs
python -m unittest discover -s tests -p "test_*.py" -v
```

Kiểm tra trình duyệt cần Playwright và Chromium:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.mjs
node tests/upgrade-browser.mjs
```

Test tự mở HTTP server. API TTS và ASR được mô phỏng trong test giao diện bằng fixture MP3 thật; microphone tổng hợp dùng MediaRecorder thật. Test mới mô phỏng hai thiết bị và máy chủ dữ liệu để kiểm tra lưu/đọc/xung đột. Có thể đặt `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_MODULE`, `TEST_OUTPUT_DIR`.

`tests/firebase-live.mjs` là kiểm tra **chủ động ghi/đọc Firebase thật**: tạo vùng ngẫu nhiên mới, dùng bài/MP3 thử, rồi xóa đúng dữ liệu thử đó. Chỉ chạy khi bạn muốn kiểm tra kết nối thật. Relay Python trong test dành cho giới hạn mạng của môi trường QA; không có trong ứng dụng triển khai. Xem `CHECKS.md` và `docs/` cho kết quả bản giao.

## Xử lý lỗi

| Thông báo | Cách xử lý |
| --- | --- |
| API 404 | Deploy cả `api/`, `public/`, `requirements.txt`; Root Directory là gốc app. |
| Tạo giọng 502/503/504 | Thử lại; xem Vercel Function Logs. Audio đã lưu vẫn có thể nghe mà không gọi dịch vụ TTS. |
| Firebase chưa cho phép lưu | Áp dụng `firestore.rules` trong Firebase Console đúng project. Bấm trạng thái đồng bộ → Đồng bộ ngay. |
| Chưa đồng bộ / mất mạng | Bản đang học được giữ trên máy; mở lại và đồng bộ. Có thể xuất file bài trước khi đóng. |
| Không ghi âm / không có bản chép | Kiểm tra HTTPS, quyền microphone và trình duyệt. Ghi âm/nghe lại rồi nhập bản chép khi ASR không hỗ trợ. |
| File gốc không phát đúng câu | Dùng định dạng trình duyệt hỗ trợ, kiểm tra mốc đầu/cuối. Audio gốc chưa có căn chỉnh từ sẽ nghe lại cả cue khi bấm từ. |

## Mã nguồn và tài liệu

`core.mjs`: chia câu/chấm từ/tiến độ/tệp. `audio.mjs`, `full-audio.mjs`: giọng đọc, MP3 và phụ đề. `capture.mjs`: microphone/ASR. `store.mjs`, `media-store.mjs`: lưu trên máy. `crypto-sync.mjs`, `cloud.mjs`, `firebase-adapter.mjs`, `rest-firestore.mjs`: mã hóa, hàng đợi, phiên bản và Firestore. `converter.mjs`: Text → MP3/lịch sử. `api/tts.py`: Python Function, `edge-tts==7.2.8`. `public/vendor/`: Firebase SDK kèm giấy phép trong mã nguồn.

Quy trình học tham khảo [Daily Dictation](https://dailydictation.com/), [Speechling](https://speechling.com/help/quickstart/) và [YouGlish](https://youglish.com/). Tài liệu kỹ thuật: [Vercel Python Functions](https://vercel.com/docs/functions/runtimes/python/api-directory), [Firebase Web setup](https://firebase.google.com/docs/web/setup), [Firestore REST](https://firebase.google.com/docs/firestore/use-rest-api), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [edge-tts](https://github.com/rany2/edge-tts).
