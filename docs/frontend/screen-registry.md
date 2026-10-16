# Screen registry — 50 màn

Nguồn: [route-audit.md](route-audit.md) (commit `85b14eb`). Cột "Route đích" là route sau khi triển khai; `(mới)` = route chưa tồn tại. Route demo nằm dưới namespace `/demo/*` (xem [implementation-plan.md](implementation-plan.md) §3), không trùng route thật.

| ID | Màn | App | Route đích | Trạng thái | Batch |
|---|---|---|---|---|---|
| ST01 | Trang chủ Marketplace | web | `/` | REFACTOR (+ form tư vấn DEMO_ONLY) | B2 pilot |
| ST02 | Danh mục & tìm kiếm | web | `/products` | REFACTOR | B3 |
| ST03 | Chi tiết sản phẩm | web | `/products/[slug]` | REFACTOR | B3 |
| ST04 | Giỏ hàng | web | `/cart` | REFACTOR | B3 |
| ST05 | Checkout | web | `/checkout` | REFACTOR | B3 |
| ST06 | Thanh toán VietQR | web | `/orders/[id]` | REFACTOR | B3 |
| ST07 | Kết quả thanh toán | web | `/orders/[id]` (trạng thái đã xác nhận) | REFACTOR — chờ quyết định Q3 | B3 |
| ST08 | Đăng nhập | web | `/login` | REFACTOR | B3 |
| ST09 | Đăng ký | web | `/register` | REFACTOR | B3 |
| ST10 | Khôi phục mật khẩu | web | `/forgot-password`, `/reset-password` (mới) | IMPLEMENT | B3 |
| ST11 | Blog | web | `/blog`, `/blog/category/[slug]` | REFACTOR | B3 |
| ST12 | Chi tiết bài viết | web | `/blog/[slug]` | REFACTOR | B3 |
| ST13 | Trang tĩnh / chính sách | web | `/demo/st13` | DEMO_ONLY | B7 |
| PT01 | Dashboard | portal | `/` | REFACTOR | B4 |
| PT02 | Sản phẩm của tôi | portal | `/entitlements` | REFACTOR | B4 |
| PT03 | Trung tâm tải xuống | portal | `/downloads` | REFACTOR | B4 |
| PT04 | Phiên bản / changelog | portal | `/entitlements/[id]` | REFACTOR | B4 |
| PT05 | Danh sách license | portal | `/licenses` | REFACTOR | B4 |
| PT06 | Chi tiết license nội bộ | portal | `/licenses/[id]` | REFACTOR | B4 |
| PT07 | Kích hoạt tên miền | portal | `/allocations` (external) · activation trong `/licenses/[id]` (internal) | REFACTOR | B4 |
| PT08 | Đơn hàng | portal | `/orders` | REFACTOR | B4 |
| PT09 | Chi tiết đơn | portal | `/orders/[id]` | REFACTOR | B4 |
| PT10 | Ticket | portal | `/tickets` | REFACTOR | B4 |
| PT11 | Hội thoại ticket | portal | `/tickets/[id]` | REFACTOR | B4 |
| PT12 | Thông báo | portal | `/notifications` | REUSE | B4 |
| PT13 | Thông tin cá nhân | portal | `/account` | REFACTOR (sửa hồ sơ DEMO_ONLY) | B4 |
| PT14 | Bảo mật tài khoản | portal | `/account/security` (mới) | IMPLEMENT (2FA BLOCKED) | B4 |
| AD01 | Đăng nhập Admin | admin | `/login` | REFACTOR | B5 |
| AD02 | Tổng quan vận hành | admin | `/` | REFACTOR | B5 |
| AD03 | Danh sách sản phẩm | admin | `/admin/products` | REFACTOR | B5 |
| AD04 | Tạo / sửa sản phẩm | admin | `/admin/products/new`, `/admin/products/[id]` | REFACTOR | B5 |
| AD05 | Phiên bản & file | admin | `/admin/products/[id]/versions` (mới) | IMPLEMENT | B5 |
| AD06 | Danh mục sản phẩm | admin | `/admin/categories` (mới) | IMPLEMENT | B5 |
| AD07 | Giá & gói license | admin | `/admin/products/[id]/pricing` (tách từ AD04) | REFACTOR | B5 |
| AD08 | Danh sách đơn | admin | `/admin/orders` | REFACTOR | B5 |
| AD09 | Chi tiết đơn | admin | `/admin/orders/[id]` (mới) | IMPLEMENT | B5 |
| AD10 | Đối soát thanh toán | admin | `/admin/payments/[id]` (mới) | IMPLEMENT (hàng đợi BLOCKED) | B6 |
| AD11 | Entitlement | admin | `/admin/entitlements` (mới) | IMPLEMENT | B6 |
| AD12 | License nội bộ | admin | `/admin/licenses` (mới) | IMPLEMENT | B6 |
| AD13 | License quản lý hộ | admin | `/admin/allocations` (mới) | IMPLEMENT | B6 |
| AD14 | Khách hàng | admin | `/admin/users` (mới) | IMPLEMENT (gán role BLOCKED) | B6 |
| AD15 | Ticket admin | admin | `/admin/tickets` (mới) | IMPLEMENT | B6 |
| AD16 | Chi tiết ticket admin | admin | `/admin/tickets/[id]` (mới) | IMPLEMENT | B6 |
| AD17 | Bài viết CMS | admin | `/content` — chờ Q2 | REFACTOR | B6 |
| AD18 | Biên tập bài viết | admin | `/content/new`, `/content/[id]` — chờ Q2 | REFACTOR | B6 |
| AD19 | Danh mục / Media CMS | admin | `/content/categories` (media DEMO_ONLY) — chờ Q2 | REFACTOR | B6 |
| AD20 | Automation & jobs | admin | `/automation`, `/automation/[id]` — chờ Q2 | REFACTOR | B6 |
| SY01 | 403 | portal, admin | component `Forbidden` + trang `/403` | IMPLEMENT | B1 |
| SY02 | 404 | web, portal, admin | `not-found.tsx` | REFACTOR / IMPLEMENT | B1 |
| SY03 | 500 | web, portal, admin | `error.tsx` + `global-error.tsx` | REFACTOR / IMPLEMENT | B1 |

Q2, Q3: câu hỏi mở trong [implementation-plan.md](implementation-plan.md) §5.
