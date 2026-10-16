# Backlog — việc phát sinh từ triển khai frontend

Mỗi mục là một PR riêng, cần chủ dự án duyệt trước khi làm. Chưa có mục nào được triển khai; **không sửa schema/API** trong các batch frontend. Chi tiết kỹ thuật: [backend-proposals.md](backend-proposals.md).

Ghi chú: hiện chưa tạo được GitHub Issue (GitHub CLI chưa được cấp quyền lại). Khi có quyền, mỗi dòng dưới đây thành một issue với nhãn tương ứng.

## Release blockers — Storefront

| ID | Việc | Vì sao chặn ra mắt | Đề xuất |
|---|---|---|---|
| **BL-1 (P2)** | **API quản lý ảnh sản phẩm** (upload / sắp xếp / xóa qua Admin) | Không có endpoint ghi `product_media` → trên production mọi thẻ sản phẩm, gallery, showcase chỉ có hình thay thế. Ảnh demo hiện chỉ chèn được bằng SQL vào DB tạm | P2 |

## Backlog — backend

| ID | Việc | Ưu tiên đề xuất | Ảnh hưởng frontend khi có | Đề xuất |
|---|---|---|---|---|
| BL-2 (P1) | Vị trí trưng bày sản phẩm (`product_placements`) — sản phẩm nổi bật, sắp xếp thủ công | Cao | ST01 showcase "Theme nổi bật" thay "Mới phát hành" (đóng điểm lệch D3) | P1 |
| BL-3 (P3) | API nhận yêu cầu tư vấn `POST /v1/leads` + chống spam + lưu đồng ý | Trung bình | Bật form tư vấn thật trên production, bỏ `FEATURE_CONSULT_FORM_DEMO` | P3 |
| BL-4 (P4) | `total` cho `GET /orders`, `/entitlements`, `/licenses`, `/tickets` | Trung bình | PT01/PT08 hiển thị được số tổng | P4 |
| BL-5 | Endpoint public cho nội dung `PAGE` (chính sách) | Trung bình | ST13 thành trang thật; footer link được trang chính sách (đóng D7) | route-audit §2 |

## Backlog — môi trường / CI

| ID | Việc | Ghi chú |
|---|---|---|
| BL-6 | Chạy `apps/e2e` trong CI (job riêng: dựng stack, seed demo, Playwright) | Hiện chạy thủ công trong container `mcr.microsoft.com/playwright:v1.48.0-jammy` |
| BL-7 | Máy dev Windows: Application Control chặn `turbo.exe` và binary SWC của Next | Kiểm thử phải chạy trong Docker; cần IT whitelist nếu muốn chạy trực tiếp |
