# ShadowLab — luyện nghe, dictation, shadowing và Text → MP3

Bản cập nhật dùng Firebase project `shadow-study-mindlab` theo cấu hình được cung cấp. Không cần tài khoản trong app. Bài học, tiến độ, giọng đọc, ghi chú, âm thanh và lịch sử MP3 được mã hóa trên trình duyệt rồi đồng bộ lên Cloud Firestore. Vẫn có thể xuất/mở `.shadow.json` để sao lưu chủ động.

## Triển khai lên Vercel

1. Giải nén. Đưa **nội dung bên trong** thư mục `Learn-ShadowingDictation-main` lên GitHub. Ở gốc repository phải có `vercel.json`, `requirements.txt`, `api/` và `public/`.
2. Trên Vercel: **Add New → Project → Import** repository. Chọn **Framework Preset: Other**. Root Directory là thư mục chứa `vercel.json`, không chọn `public`.
3. Giữ Build Command trống, Output Directory `public`. Cấu hình đã nằm trong `vercel.json`; không cần build frontend hay điền biến môi trường.
4. Nhấn **Deploy**, mở URL HTTPS. Thử tạo bài hoặc mở `examples/Tea-at-the-cafe.shadow.json` để nghe MP3 mẫu đã có.
5. Trong [Firebase Console của dự án](https://console.firebase.google.com/project/shadow-study-mindlab/firestore/rules), chọn **Firestore Database → Rules**, dán nội dung `firestore.rules` rồi **Publish**. Rules này dành cho app cá nhân này; nếu dự án còn ứng dụng khác, ghép các đường dẫn của ShadowLab vào rules hiện có của bạn.
6. Mở cùng địa chỉ app trên các thiết bị. App tự dùng một vùng Firebase chung; không cần sao chép mã riêng. Xem `SYNC-FIX.md` để chuyển dữ liệu từ bản cũ. Giữ nguyên `public/sync-config.mjs` trong các lần cập nhật sau.

Firestore của dự án đã được kiểm tra ghi/đọc dữ liệu thử thật. Các bản ghi thử của lần kiểm tra hoàn tất đã được xóa. Chưa triển khai bản cập nhật vào tài khoản Vercel của bạn. Không cần bật Firebase Authentication, Cloud Storage hoặc Analytics để app hoạt động. Nếu cơ sở dữ liệu `(default)` chưa có trên một dự án khác, tạo Cloud Firestore trước khi dùng.

Nếu dùng CLI, chạy `vercel` tại gốc app; kiểm tra Preview rồi dùng `vercel --prod` khi muốn xuất bản. `GET /api/tts` kiểm tra Python Function; để xác nhận dịch vụ giọng đọc, cần phát/tạo MP3 bằng POST.

## Giao diện mới

Bản này cập nhật giao diện theo ảnh và bản mô tả: màu xanh–trắng, font Be Vietnam Pro hỗ trợ tiếng Việt, đóng kèm, vùng học một cột ở giữa và không có sidebar cố định. Giữ nguyên cơ chế audio, nhận diện, chấm bài, tiến độ, Firebase và định dạng tệp.

| Công cụ | Vị trí trên giao diện mới |
| --- | --- |
| Listen / Dictation / Shadowing / Review | Menu giai đoạn ở góc phải tên bài. |
| Đổi bài, mở file, lưu file, xóa bài | Menu **Bài học** trên thanh đầu trang. Xóa và thay bài có popup xác nhận. |
| Nghe, tạm dừng, tiếp tục | Nút tròn ở giữa bộ phát, đổi Play/Pause theo trạng thái. Nút bên trái nghe lại câu; nút vuông bên phải dừng. |
| Tốc độ nghe và MP3 câu | Dropdown tốc độ bên trái bộ phát; icon tải xuống bên phải. |
| Phụ đề, bản dịch, tự sang câu | Menu **Hiển thị** dưới bộ phát. Dictation giữ nguyên logic gợi ý/ẩn đáp án. |
| Ghi chú, giọng, vai, khoảng chờ, lặp, tự ghi âm, file nguồn | Các icon ghi chú/thiết đặt dưới bộ phát hoặc menu **Bài học**. Mở bảng bên phải; các trường vẫn tự lưu. |
| Chuẩn bị audio và MP3 toàn bài | Menu audio ba chấm cạnh bộ phát; MP3 toàn bài cũng có trong **Giọng & thiết đặt**. |
| Sửa câu | Menu ba chấm bên cạnh ngôi sao. |
| Chuyển câu, danh sách câu | Mũi tên trên câu, các nút số ở cuối bài hoặc **Danh sách câu**. Bài dài dùng bảng danh sách; mobile hiện một nhóm số quanh câu hiện tại. |
| Thống kê | Nhấn thanh tiến độ cạnh tên bài. Chỉ dùng dữ liệu luyện tập thật. |
| Chấm nghiêm ngặt | Icon tùy chọn cạnh dropdown **Full dictation**. |
| Bản chép lời nói | Mở **Nhập / sửa bản chép lời nói** trong Shadowing. Bản ghi và kết quả xuất hiện sau khi có dữ liệu. |
| Hướng dẫn | Icon dấu hỏi trên thanh đầu trang; thông tin Shadowing có icon nhỏ cạnh chế độ. |

Thông báo thao tác hiện ở góc màn hình và tự ẩn. Lỗi giữ hiển thị cho đến khi đóng; lỗi trong biểu mẫu hiện ngay trong popup. Escape đóng menu/popup; Arrow Down mở menu từ bàn phím. Khi đóng cửa sổ tạo bài hoặc sửa câu có thay đổi chưa lưu, app xác nhận trước; chọn Hủy giữ nguyên nội dung đang nhập. Mở bảng thông tin không tự dừng audio hoặc xóa bản nháp. Nội dung dài dùng luồng cuộn của trang; laptop 1365×768 chứa được một lượt Shadowing thông thường và thanh chuyển câu trong cùng màn hình.

Sau lượt Shadowing, mức khớp bản chép hiện gọn; **Xem đối chiếu từng từ** mở các từ đúng/sai/thiếu/thừa, vẫn bấm từ để nghe lại. Nút **Luyện lại**, ghi âm thủ công và **Câu tiếp theo** nằm ngay dưới kết quả. Sau khi sửa bản chép, điểm cũ được ghi **Bản trước** cho đến khi nhấn Đối chiếu. Trong lượt ghi âm hiện tại, có thể xem bản nhận diện trước khi sửa; đây là thông tin trình bày, không thay cấu trúc dữ liệu lưu. Trên điện thoại, thông tin bài và menu giai đoạn xếp một cột; cỡ chữ và vùng nhấn được tăng để dễ đọc.

## Bổ sung dịch và giao diện

- **Dịch tự động:** khi tạo bài tiếng Anh, mở bài cũ chưa có bản dịch hoặc tạo bài luyện từ Text → MP3, app tự tạo bản dịch tiếng Việt cho từng câu và cả đoạn. Dịch chạy nền, không chặn việc học/phát audio. Menu **Bài học → Bản dịch toàn bài** mở bản dịch trong popup; bản dịch câu dùng nút hiển thị có sẵn. Dictation vẫn ẩn bản dịch để giữ cách luyện hiện tại.
- Bản dịch được lưu trong bài trên Firebase và tệp `.shadow.json`. Mở lại dùng bản đã lưu. Sửa tiếng Anh tự cập nhật bản dịch tự động tương ứng; bản dịch đã sửa thủ công được giữ. Bài dài được dịch theo nhóm có ngữ cảnh; kết quả hoàn thành được lưu từng nhóm. Thay đổi khi mất mạng được giữ trong hàng đợi tạm; có **Dịch phần còn thiếu**, và thử lại khi kết nối trở lại.
- **Nút trăng/mặt trời** cạnh Hướng dẫn đổi sáng/tối. **Bài học → Giao diện & hiệu ứng** có màu chủ đạo, cường độ gradient xanh nhẹ, âm lượng, bật/tắt âm thanh và hiệu ứng. Lưu cùng bài và đồng bộ thiết đặt chung giữa các thiết bị qua Firebase, kể cả khi chưa chọn bài. Các vùng học, menu, cơ chế audio và chức năng cũ được giữ.
- Âm đúng/sai, chúc mừng hoàn tất bài và hiệu ứng vào Review được tổng hợp ngay trên trình duyệt. Không tải thêm âm thanh. Phản hồi âm thanh được chặn khi đang phát mẫu/bản ghi hoặc dùng microphone; hiệu ứng tôn trọng Reduce Motion của thiết bị.
- Font **Be Vietnam Pro** có Regular 400, Medium 500, SemiBold 600, Bold 700 đóng kèm. Đã kiểm tra các ký tự tiếng Việt dựng sẵn và dấu Unicode tổ hợp trong cả bốn tệp.

Dịch mặc định không cần thêm tài khoản/key: Bing Translator, với Google và MyMemory dự phòng. Dịch miễn phí có thể tạm giới hạn theo mạng/quota; app giữ phần đã lưu và cho thử lại, không thay bằng bản dịch giả. Nếu muốn dùng Google Cloud Translation chính thức, có thể thêm biến môi trường **GOOGLE_TRANSLATE_API_KEY** trên Vercel và bật Cloud Translation API cho key đó; đây là lựa chọn, không phải điều kiện chạy app. Văn bản cần dịch được gửi đến dịch vụ dịch; bản đã lưu không cần gửi lại khi mở bài.

`api/translate.py` là Function bổ sung; `public/translation.mjs` quản lý hàng đợi và giữ bản dịch thủ công; `preferences.mjs`, `experience.mjs`, `experience.css` quản lý màu/âm/hiệu ứng. Không cần thay Firestore Rules hiện tại hoặc chuyển dữ liệu cũ. Chỉ đưa mã nguồn cập nhật lên repository rồi Deploy lại Vercel như trước.

## Các tính năng được giữ lại

| Yêu cầu | Cách sử dụng |
| --- | --- |
| Bỏ thanh bên | Màn hình chọn bài có tìm kiếm và tiến độ. **Đổi bài** tự lưu bài đang học rồi mở danh sách. |
| Tập trung trong một khung hình | Bộ phát và bài tập nằm theo một luồng dọc. Danh sách câu, ghi chú, thống kê và thiết đặt mở khi cần. Nội dung dài cuộn trên trang; không còn hai cột học cuộn độc lập. |
| Giọng theo nhân vật/người đọc | **Giọng & thiết đặt** thống kê số câu, số từ của từng người. Chọn Sonia/Ryan/Libby/Thomas, tốc độ tạo giọng từ −50% đến +50%, cao độ từ −50 đến +50 Hz. Đoạn văn có dòng **Người đọc**. |
| Nghe toàn bài tự nhiên hơn | Tự tải trước khi mở bài. Văn bản liên tiếp cùng giọng được tổng hợp chung, thay vì tạo từng câu. Bài dài hơn 5.000 ký tự/850 từ mỗi nhóm được chia thành vài nhóm lớn và ghép thành một MP3. Hội thoại ghép các nhóm giọng đã tải, giảm im lặng cuối nhóm. Khi phát không cần chờ gọi API giữa các câu. |
| Phụ đề theo âm thanh | Toàn bài dùng mốc từ của TTS để đổi câu và tô từ đang đọc. Với file gốc, mốc câu từ phụ đề và vị trí từ ước lượng vẫn được ghi rõ. |
| Đổi tốc độ ngay lúc học | Thanh **0.5×–2×** hoạt động trong Listen, Dictation và Shadowing, không phải tạo lại MP3. Tốc độ/cao độ tạo giọng trong hộp thiết đặt là thông số khác và được ghi vào MP3. |
| Firebase | Tự lưu thiết đặt riêng mỗi bài, bản nháp, ghi chú câu/toàn bài, kết quả, từ cần ôn, bản dịch và audio mẫu/nguồn. Khi mở bài, tải thiết đặt/audio đã lưu. Mất mạng giữ hàng đợi tạm rồi gửi lại. Sửa cùng bài trên hai thiết bị sẽ yêu cầu chọn phiên bản. Bản ghi âm người học chỉ lưu trên thiết bị. |
| Text → MP3 | Tab riêng để dán tiếng Anh, chọn giọng/tốc độ/cao độ, tạo và tải MP3. Lịch sử tự lưu và đồng bộ. Có thể mở lại hoặc **Tạo bài luyện từ đoạn này**. |

## Một bài học

1. **Tạo bài** → nhập tên và văn bản/TXT/SRT/VTT → **Phân tích & chia câu**. Kiểm tra người nói và câu trong bản xem trước. Gộp chỉ những đoạn cùng người nói.
2. **Listen**: nghe toàn bài, nghe từng câu, bật/ẩn phụ đề; nhấn từ để nghe lại trong câu. Bản dịch tiếng Việt được tạo tự động theo câu và toàn bài; vẫn có thể chỉnh trong **Sửa câu**.
3. **Dictation**: Full dictation hoặc Fill in the blanks; kiểm tra từ đúng/sai/thiếu/thừa/sai vị trí. Có chế độ nghiêm ngặt. Gợi ý: số chữ cái → chữ đầu → hiện một phần từ → đáp án. App giữ số lần nghe, gợi ý và làm lại.
4. **Shadowing**: Listen & Repeat, Simultaneous, Delayed hoặc Continuous. Có chọn vai, khoảng chờ, lặp, ghi âm và phát lại. Continuous không chọn vai phát từ câu hiện tại đến hết trên một file; nếu chọn vai, app dành lượt để bạn nói.
5. **Review**: luyện từ sai, câu gắn sao và câu đến hạn; ghi chú từ/nối âm. **Đổi bài** tự lưu; hôm sau mở cùng app và chọn bài trong danh sách.

Nhận diện giọng nói cho biết **bản chép lời nói khớp văn bản gốc đến mức nào**, không đo phát âm từng âm. Có thể sửa bản chép và đối chiếu lại. Dùng tai nghe khi vừa nghe mẫu vừa ghi âm. Khi ASR không được hỗ trợ hoặc không kết nối, vẫn ghi âm, nghe lại và nhập bản chép thủ công. Web Speech có thể gửi audio tới dịch vụ nhận diện của trình duyệt.

Ghi âm tự dừng sau khoảng 2,3 giây im lặng khi đã có tiếng nói; tối đa 90 giây/lượt. Bản ghi Continuous được giữ cho cả lượt; đối chiếu từng câu được thực hiện khi bản chép nằm trong giới hạn xử lý. Với lượt rất dài, dùng luyện từng câu để kiểm tra chi tiết.

Câu hoàn tất sau dictation 100% không gợi ý và đối chiếu lời nói ít nhất 90%. Lịch ôn tăng 1 → 2 → 4 → 8 → 16 → 30 ngày sau lượt hoàn hảo không gợi ý; lượt chưa hoàn hảo hẹn hôm sau. Câu gắn sao/lỗi chưa giải quyết vẫn được đưa vào Review.

## Đồng bộ và sao lưu

- Chỉ cần mở `https://your-app.vercel.app/` trên các thiết bị. `public/sync-config.mjs` cố định vùng dữ liệu của app; không tạo vùng mới theo thiết bị. URL có `#sync=…` được giữ để tương thích. Đừng đổi khóa trong tệp này khi cập nhật app.
- Liên kết cũ và mã cũ còn trên thiết bị được dùng để nhập dữ liệu vào vùng chung. Quá trình này giữ bản gốc trên Firebase cũ; mở lại không tạo bài trùng. Nếu cả bản cũ và bản chung đều đã thay đổi, giữ thêm bản lưu cũ thay vì ghi đè.
- Chỉ coi dữ liệu đã gửi xong khi trạng thái hiện **Đã đồng bộ**. Nhấn trạng thái để xem chi tiết Firebase. Nếu đóng tab lúc còn chờ, hàng đợi được giữ để gửi khi mở lại. Tránh xóa dữ liệu trình duyệt trước khi đồng bộ hoặc xuất bài.
- Không ghi bài/cài đặt mới vào localStorage. Firebase giữ thư viện đã đồng bộ. IndexedDB chỉ giữ bản ghi âm người học và hàng đợi thay đổi chưa được xác nhận; hàng đợi được dọn sau khi gửi xong. Audio mẫu đã đồng bộ được tải từ Firebase và giữ trong RAM. Nếu trình duyệt chặn IndexedDB, app báo cần giữ trang mở đến khi Firebase xác nhận.
- **Lưu file bài** xuất `.shadow.json`. Chọn kèm audio để giữ MP3, file nguồn và bản ghi. Có thể nhập file bản cũ của ShadowLab. Dữ liệu localStorage cũ được chuyển một lần; chỉ dọn sau khi Firebase xác nhận. Nếu đổi tên miền, mở liên kết cũ trên tên miền mới hoặc nhập file đã xuất; bản ghi âm cục bộ cần xuất file kèm audio để chuyển thiết bị.
- File bài tối đa khoảng 90 MB; file audio/video gốc tối đa 45 MB. Media được chia nhỏ trong Firestore, không cần Cloud Storage. File lớn đồng bộ lâu hơn và sử dụng nhiều lượt đọc/ghi, dung lượng của Firebase. Xem [giới hạn Firestore](https://firebase.google.com/docs/firestore/quotas).

Rules đính kèm chặn các đường dẫn khác và việc liệt kê toàn bộ vùng. Dữ liệu học vẫn được mã hóa AES-GCM. Khóa vùng chung có trong mã JavaScript của app: tất cả người mở app này dùng cùng thư viện, đúng mô hình một người dùng không tài khoản. Đây không phải cơ chế xác thực hoặc phân quyền. Không có service-account key trong mã.

App dùng Firestore REST với điều kiện phiên bản ở máy chủ; chỉ báo Đã đồng bộ sau phản hồi xác nhận. Khi tab đang hiển thị, kiểm tra thay đổi khoảng 4 giây/lần và kiểm tra ngay khi trở lại tab hoặc có mạng. Bấm **Đồng bộ ngay** để tải lại chủ động. Firebase SDK cũ vẫn được giữ trong bộ mã để tương thích, không thay cơ chế chức năng học.

## Chạy tại máy và kiểm tra

Cần Python 3.12. Chạy tại thư mục gốc:

```sh
python -m pip install -r requirements.txt
python dev.py
```

Mở `http://127.0.0.1:8000`. Không mở `index.html` bằng `file://`, vì API/microphone và mã hóa cần HTTPS hoặc localhost.

Kiểm tra logic/API:

```sh
node --test --test-reporter=tap tests/core.test.mjs tests/sync-audio.test.mjs tests/translation.test.mjs tests/browser-translation.test.mjs tests/experience.test.mjs tests/firebase-storage.test.mjs tests/shared-sync.test.mjs
python -m unittest discover -s tests -p "test_*.py" -v
```

Kết quả bản sửa đồng bộ hiện tại nằm trong `SYNC-FIX.md` và `docs/sync-repair-20261010/`. `CHECKS.md` cùng các báo cáo cũ ghi lại các lần kiểm tra trước, không phải kết quả mới. Chưa chạy kiểm thử giao diện bằng Chromium cho bản sửa này.

Kiểm tra trình duyệt cần Playwright và Chromium:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.mjs
node tests/upgrade-browser.mjs
node tests/presentation-browser.mjs
node tests/enhancements-browser.mjs
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

`core.mjs`: chia câu/chấm từ/tiến độ/tệp. `audio.mjs`, `full-audio.mjs`: giọng đọc, MP3 và phụ đề. `capture.mjs`: microphone/ASR. `store.mjs`, `media-store.mjs`: lưu trên máy. `crypto-sync.mjs`, `cloud.mjs`, `firebase-adapter.mjs`, `rest-firestore.mjs`: mã hóa, hàng đợi, phiên bản và Firestore. `converter.mjs`: Text → MP3/lịch sử. `presentation.mjs`: menu, popup, thông báo và cách trình bày tiến độ; gọi lại các handler có sẵn. `api/tts.py`: Python Function, `edge-tts==7.2.8`. `public/vendor/`: Firebase SDK kèm giấy phép trong mã nguồn. `public/fonts/`: Be Vietnam Pro (4 trọng lượng) và giấy phép SIL Open Font License; Poppins cũ được giữ để tương thích.

Quy trình học tham khảo [Daily Dictation](https://dailydictation.com/), [Speechling](https://speechling.com/help/quickstart/) và [YouGlish](https://youglish.com/). Tài liệu kỹ thuật: [Vercel Python Functions](https://vercel.com/docs/functions/runtimes/python/api-directory), [Firebase Web setup](https://firebase.google.com/docs/web/setup), [Firestore REST](https://firebase.google.com/docs/firestore/use-rest-api), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [edge-tts](https://github.com/rany2/edge-tts), [Be Vietnam Pro](https://github.com/bettergui/BeVietnamPro), [Bing Translate API](https://github.com/plainheart/bing-translate-api), [Cloud Translation](https://cloud.google.com/translate/docs/basic/translating-text).
