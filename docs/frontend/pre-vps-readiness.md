# PGS trước khi mua VPS — sổ công việc và dữ liệu đầu vào

**Cơ sở:** `main` tại thời điểm mở PR; CI không thay thế cho nghiệm thu Supabase/R2/n8n thật. Các đợt frontend theo [implementation-plan.md](implementation-plan.md). Không đổi schema/RBAC hoặc chạm production trong các công việc bên dưới.

| Luồng | Hiện trạng đã xác minh từ repo | Việc làm tiếp | Điều kiện nghiệm thu |
| --- | --- | --- | --- |
| Storefront B3 | ST01 đã merge; ST02–ST12 có phần lớn route cũ; ST10 còn thiếu | PR này bắt đầu ST10, tiếp theo ST02–ST09, ST11–ST12 từng màn | 1440/768/390, loading/empty/error, Playwright giao dịch bằng môi trường giả lập |
| Portal B4 | Các route PT01–PT13 đã có, UI còn nhiều tiếng Anh; PT14 chưa có | Việt hóa, trạng thái tải/rỗng/lỗi, bảo mật tài khoản PT14 | Không dùng tổng số API không trả, auth/ownership fail-closed |
| Admin B5/B6 | Trang chủ có chức năng chẩn đoán; nhiều route nghiệp vụ chưa có trang và shell đồng nhất | Xây shell theo quyền trước; sau đó products/orders rồi các nghiệp vụ còn lại | 403, RBAC, xác nhận hành động nguy hiểm, kiểm thử API thật |
| Backend/CI | Phase 4–18, Services và ST01 E2E đã có | Tiếp tục regression với các route B3–B6; không bật payment test provider ở production | CI 7/7, luồng thanh toán chỉ trong CI cách ly |
| Docker/n8n | Có Compose staging, preflight, F07/F08 và 4 workflow JSON | Validate workflow trên CI; sau khi có máy chủ mới thử runtime/email thật | Có log, HMAC, retry, không rò PII; staging UAT |
| Dữ liệu | Có seed catalog/demo và 6 dịch vụ trong `service-seed.ts` | Thu thập dữ liệu thực, đưa qua Admin sau duyệt; **không** commit key hay data khách | Đủ trường, giấy phép hợp lệ, ảnh có quyền dùng, link kiểm tra được |

## Dữ liệu PGS cần tập hợp, không đưa credentials vào GitHub

### Sản phẩm số (mỗi SKU)
- Tên, slug, danh mục, loại sản phẩm/fulfillment, mô tả ngắn và chi tiết, tính năng, ảnh thumbnail + gallery có quyền sử dụng, file phát hành và phiên bản, license/pricing, chính sách cập nhật/hỗ trợ, trạng thái DRAFT/ACTIVE.
- Chỉ để **DRAFT** nếu thiếu giấy phép, giá, hình ảnh, file hoặc điều khoản. Seed demo không được xuất hiện như hàng thật.

### Dịch vụ (mỗi dịch vụ)
- Slug, tên thương mại, tóm tắt, vấn đề giải quyết, đối tượng sử dụng, quy trình triển khai, phạm vi bàn giao, cách báo giá, FAQ, ảnh thực tế được phép đăng.
- Sáu dịch vụ seed ban đầu là **mẫu nội dung**, trạng thái DRAFT trong production. Admin phải xác nhận trước khi chuyển ACTIVE.

### CMS/SEO và chính sách
- Bài blog: title, slug, excerpt, body, tác giả, danh mục, ảnh/alt, metadata, internal links, trạng thái biên tập, ngày dự kiến xuất bản.
- Chính sách quyền riêng tư HTTPS được duyệt, phiên bản consent tương ứng; trang liên hệ và thông tin pháp nhân chính xác. Tuyệt đối không tự tạo lời chứng thực khách hàng giả.

### Accounts và nghiệp vụ kiểm thử
- Tài khoản Supabase **staging riêng** cho khách/nhân viên có quyền/không quyền; dữ liệu thanh toán giả của CI.
- Chỉ số bàn giao: tổng màn đạt Figma, số scenario E2E, tỷ lệ CI, bug còn mở. Không dùng dữ liệu cá nhân của khách thật.

## ST10: quy tắc an toàn
- Link `/forgot-password` từ form đăng nhập; gửi email qua Supabase `resetPasswordForEmail`, thông báo chung để hạn chế dò email.
- `/reset-password` chỉ cho cập nhật khi có phiên xác thực và callback khôi phục; validate mật khẩu, không nhúng access token vào URL mới.
- Để hoạt động trên staging, thêm `https://<WEB_DOMAIN>/reset-password` vào **Supabase Auth → URL Configuration → Redirect URLs** của project staging và cấu hình SMTP/email template; kiểm thử email thật là gate staging, chưa được xác nhận trong CI.

## Thứ tự PR đề xuất
1. **B3 ST10** (PR này), tiếp tục các màn Storefront B3 theo Figma.
2. **B4 Portal** (ưu tiên PT14 và nhất quán tiếng Việt).
3. **B5 Admin** (shell/role + danh mục/sản phẩm/đơn).
4. **CI regression n8n và API**, chia nhỏ theo chức năng, không làm yếu CI.
5. **Content intake** sau khi nhận tài sản/giá/chính sách từ PGS.

Không merge tự động bất kỳ PR nào, không triển khai VPS hoặc bật `FEATURE_SERVICES` production khi chưa có phê duyệt riêng.
