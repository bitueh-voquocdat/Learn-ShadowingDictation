# Sửa đồng bộ Firebase — 10/10/2026

Bản sửa dùng đúng bộ mã nguồn trong `Learn-ShadowingDictation-main.zip`. Chỉ sửa lớp đồng bộ, phần kết nối với lớp đó và lời hướng dẫn đồng bộ. Không viết lại app.

## Nguyên nhân dữ liệu chỉ hiện trên một thiết bị

`workspaceIdentity()` trước đây chọn mã trong `#sync=…`, mã cũ trên thiết bị hoặc tự sinh mã mới. Mã này quyết định đường dẫn `shadowlab/{scope}` và khóa giải mã. Vì vậy, hai thiết bị mở địa chỉ app thông thường có thể dùng hai thư viện Firebase khác nhau, dù đều hiện đã lưu thành công. Việc chỉ sửa API ghi/đọc không giải quyết được lỗi chọn sai thư viện này.

`public/sync-config.mjs` nay cố định một vùng dữ liệu cho bản app. Tất cả thiết bị mở URL thông thường dùng cùng vùng đó. **Giữ nguyên file này trong mọi lần cập nhật sau; không tự sinh lại khóa.** App vẫn không yêu cầu đăng nhập. Khóa có trong JavaScript được phát cho trình duyệt, nên tất cả người mở app dùng cùng thư viện; đây không phải cơ chế xác thực người sở hữu.

## Các thay đổi

| Phần | Cách sửa |
| --- | --- |
| Chọn vùng Firebase | URL thông thường và liên kết cũ đều chọn vùng chung. Mã cũ được dùng làm nguồn nhập dữ liệu. |
| Chuyển bài cũ | Đọc bài, tiến độ, bản dịch và audio từ vùng cũ, giải mã rồi lưu sang vùng chung. ID nhập được tính ổn định để mở lại không tạo bài trùng. Không xóa dữ liệu nguồn trên Firebase. |
| Bản cũ và bản chung cùng được sửa | Giữ thêm bài có hậu tố `(Bản lưu cũ)` khi cần, tránh ghi đè bài chung đã được học tiếp. Bài đã xóa ở vùng chung không bị tự khôi phục từ liên kết cũ. |
| Gián đoạn khi chuyển | Giữ nguồn cũ và mã nguồn trong URL `from=…` để tải lại tiếp tục được. Chỉ dọn localStorage cũ sau xác nhận. |
| Mất mạng hoặc tải lại trang | IndexedDB giữ tạm thay đổi chưa được xác nhận, gồm bản nháp, cài đặt và audio mẫu mới. Mở lại phục hồi hàng đợi và gửi tiếp. Xóa hàng đợi sau xác nhận Firebase. Không ghi dữ liệu mới vào localStorage. |
| Mất phản hồi sau khi server đã lưu | Lưu mã phiên bản đang gửi trong hàng đợi; đối chiếu với server khi mở lại để nhận biết lần ghi đã thành công. |
| Chỉnh sửa trong lúc đang tải/gửi | Đánh dấu bản nháp trước khi chờ thao tác bất đồng bộ. Xác nhận của bản cũ không xóa thay đổi mới hơn. Phản hồi tải chậm không làm lùi bản vừa được xác nhận. |
| Hai thiết bị cùng sửa | Dùng điều kiện phiên bản ở server. Giữ popup chọn phiên bản bài học có sẵn. Cài đặt giao diện được gộp khi sửa các mục khác nhau; cùng sửa một mục thành hai giá trị khác nhau vẫn yêu cầu chọn. |
| Cập nhật từ thiết bị khác | Kiểm tra khoảng 4 giây/lần khi tab hiển thị; kiểm tra ngay khi trở lại tab/có mạng. Phản hồi thành công dù không có thay đổi vẫn phục hồi trạng thái kết nối. |
| Audio và lịch sử | Không xóa chunk của nội dung hiện tại khi dọn lịch sử. Audio mẫu, nguồn và MP3 vẫn đồng bộ; bản ghi âm người học vẫn chỉ nằm trên thiết bị. |

Các bản ghi âm giữ nguyên cơ chế thay bản ghi tại cùng vị trí và dọn sau 30 ngày. Không chuyển bản ghi âm người học lên Firebase hoặc đưa vào hàng đợi cloud. Khi nhập vùng cũ trên cùng thiết bị/origin, bản ghi được giữ cho bài đã chuyển.

## Cập nhật nhanh

1. Đưa nội dung ZIP đã sửa vào repository hiện tại, giữ nguyên tên miền Vercel đang dùng và `public/sync-config.mjs` mới này. Redeploy như trước, không cần thêm tài khoản, biến môi trường hoặc thay cấu hình Vercel.
2. Trên mỗi thiết bị có dữ liệu cũ, mở lại **liên kết cũ còn phần `#sync=…`** bằng bản app mới. Nếu mã cũ còn trong trình duyệt, mở URL thông thường cũng tự phát hiện được. Chờ trạng thái **Đã đồng bộ** rồi mở cùng URL thông thường trên thiết bị khác.
3. Nếu trước đây mã chỉ nằm trong URL và đã bị mất, app không thể đoán khóa giải mã vùng cũ. Mở lại bookmark/lịch sử liên kết cũ hoặc nhập file `.shadow.json` đã xuất để chuyển bài. Không xóa dữ liệu trình duyệt trước khi hoàn tất.
4. Nếu đổi tên miền, có thể mang phần `#sync=…` cũ sang tên miền mới để nhập bài từ Firebase. Bản ghi âm cục bộ thuộc origin cũ; dùng file bài xuất kèm audio để mang bản ghi sang nơi khác.

Các module frontend cần thay: `app.mjs`, `cloud.mjs`, `crypto-sync.mjs`, `rest-firestore.mjs`, `index.html`; thêm `sync-config.mjs`, `sync-outbox.mjs`, `sync-migration.mjs`. Tất cả nằm trong `public/`. ZIP đã tích hợp đủ, không cần chép các đoạn code rời.

`firestore.rules` chỉ đổi chú thích, giữ nguyên các điều kiện cho phép đọc/ghi. Không cần áp lại rules nếu dự án đang dùng đúng rules trong bản gốc. `api/`, `requirements.txt`, `vercel.json`, CSS, font và các module học không thay đổi.

## Kiểm tra

- 100 kiểm tra JavaScript đạt, gồm 20 kiểm tra hồi quy mới cho vùng chung, hai chiều, xung đột, hàng đợi, tải lại, mất xác nhận và chuyển dữ liệu cũ.
- 16 kiểm tra API Python đạt sau khi cài đúng dependency đã có trong `requirements.txt`; không sửa các API.
- Đã kiểm tra cú pháp 35 file JavaScript. Cấu trúc HTML và các thuộc tính điều khiển được đối chiếu với ZIP gốc; chỉ đổi chữ hướng dẫn/title liên quan đồng bộ. CSS, font, module chấm bài, phát audio, ASR/ghi âm, dịch, MP3, hiệu ứng và định dạng tệp được so sánh byte với bản gốc và giữ nguyên.
- Kết quả vòng ghi/đọc Firebase thật nằm trong `docs/sync-repair-20261010/firebase-shared-live-report.json`. Probe mở các phiên RAM độc lập từ URL không có mã sync, kiểm tra bản app được giao và chỉ tạo/xóa dữ liệu thử do probe sở hữu. Probe từ chối sửa vùng đã chứa dữ liệu người dùng.
- Vòng Firebase thật đạt 6 nhóm kiểm tra qua 68 request: phục hồi bài/tiến độ/cài đặt từ URL thường, phục hồi MP3/audio nguồn nhưng không tải bản ghi người học, cập nhật ngược chiều, xung đột thật ở server, nhập vùng cũ không tạo bài trùng và đồng bộ thao tác xóa. Đã dọn 5 bản ghi và 7 chunk thử.
- Chưa chạy kiểm thử giao diện bằng Chromium hoặc trên URL Vercel của người dùng trong lần sửa này. Các báo cáo cũ trong `CHECKS.md`/`docs/` là lịch sử kiểm tra trước.

Lệnh kiểm tra logic:

```sh
node --test --test-reporter=tap tests/core.test.mjs tests/sync-audio.test.mjs tests/translation.test.mjs tests/browser-translation.test.mjs tests/experience.test.mjs tests/firebase-storage.test.mjs tests/shared-sync.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Kiểm tra Firebase thật là thao tác ghi/đọc chủ động, chỉ chạy khi muốn kiểm tra kết nối:

```sh
node tests/firebase-shared-live.mjs
```

Mặc định probe dùng một vùng ngẫu nhiên riêng và dọn đúng các bản ghi nó tạo. Không bật `TEST_DEPLOYMENT_WORKSPACE=1` trên bản app đang có dữ liệu; tùy chọn đó chỉ dành cho kiểm tra bản giao chưa được sử dụng.

Trạng thái **Đã đồng bộ** xác nhận server đã nhận dữ liệu. Không thể cam kết đồng bộ khi Firebase chặn quyền/quota, mạng không hoạt động hoặc trình duyệt không cho lưu hàng đợi; app hiển thị lỗi/chờ và giữ thay đổi để xử lý tiếp. Tránh xóa dữ liệu trình duyệt hoặc đóng cưỡng bức trước xác nhận.

Tài liệu cơ chế server: [Firestore preconditions](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition) và [Firestore REST API](https://firebase.google.com/docs/firestore/use-rest-api).
