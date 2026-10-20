# Figma screen inventory

**Trạng thái: BLOCKED** (2026-10-20).

File chuẩn: file Figma chính thức do PGS cung cấp (link không ghi trong repo công khai). Trong phiên kiểm kê, connector Figma chính thức báo "not connected"
và kênh Figma desktop (bridge) không phản hồi. Theo nguyên tắc dự án, **không suy diễn** màn hình chưa đọc được.

Baseline lịch sử (Figma cũ, không phải inventory hiện hành): `docs/frontend/screen-registry.md` (ST01–ST13, PT01–PT14, AD01–AD20,
SY01–SY03, cập nhật 2026-10-12).

Khi đọc được Figma, mỗi màn sẽ được ghi với: mã màn, tên Figma, node URL, route, loại, API, quyền, entity, trạng thái
(Done/Partial/Missing/Mismatch), xác minh Desktop/Tablet/Mobile, action chính, test, ưu tiên — và đánh dấu màn mới / màn sửa / màn bị thay.

Cần từ PGS: kết nối lại connector Figma, hoặc mở Figma desktop với plugin bridge, hoặc cung cấp export các trang.
