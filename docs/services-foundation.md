# PGS Services Foundation

Module mở rộng nền tảng từ Marketplace sản phẩm số sang **dịch vụ theo yêu cầu**: Custom Web App, AI Chatbot, Messenger/Zalo automation, Custom Plugin, Business Process Automation (n8n/CRM), API Integration.

Phạm vi giai đoạn 1: danh mục dịch vụ, form yêu cầu dự án, nền tảng quản lý dự án (không phải ERP/CRM đầy đủ), khu vực khách hàng trên Portal, màn hình quản trị.

## Kiến trúc

Giữ nguyên Modular Monolith: một module NestJS mới `apps/api/src/modules/services`, dùng lại Auth (Supabase + `AuthGuard`), RBAC (`PermissionsGuard`), `AuditService`, S3 storage, Redis. Không có service mới, không có microservice.

```text
Storefront /services, /services/[slug] ──► POST /v1/service-inquiries (ẩn danh hoặc đã đăng nhập)
                                              │ validate DTO · honeypot · rate limit (Redis) · sniff file · submissionKey
                                              ▼
Admin /service-inquiries ──► review (NEW→REVIEWING→QUALIFIED | REJECTED | SPAM)
                         └─► convert (QUALIFIED→CONVERTED, 1 transaction, idempotent) ──► ServiceProject
Admin /service-projects  ──► status · staff · milestones · documents · messages (internal/public) · history
Portal /services         ──► khách xem yêu cầu + dự án của chính mình, nhắn tin, gửi tài liệu
```

Backend là nơi duy nhất quyết định trạng thái. Nút chuyển trạng thái trên Admin chỉ phản chiếu luật trong `packages/database/src/domain/service-engine.ts`; API từ chối mọi chuyển đổi không hợp lệ.

## Dữ liệu (migration `20261015000000_20261015_services_foundation`)

Chỉ **thêm mới** (additive): 9 bảng, 9 enum, index và khóa ngoại trên bảng mới. Không bảng/cột hiện hữu nào bị sửa hoặc xóa. `User` và `Product` chỉ thêm back-relation trong Prisma (không đổi cột).

| Bảng | Vai trò |
| :-- | :-- |
| `services` | Danh mục dịch vụ: slug, mô tả, features, process steps, ảnh, CTA, `pricing_mode` (`QUOTE_REQUIRED` / `DIRECT_CHECKOUT` → `product_id`), trạng thái |
| `service_inquiries` | Yêu cầu dự án; `submission_key` unique (idempotency), `ip_hash` (SHA-256 có salt), `user_id` null nếu ẩn danh |
| `service_inquiry_attachments` | File đính kèm (storage key do server sinh, sha256, MIME đã sniff) |
| `service_projects` | Dự án; `inquiry_id` unique → mỗi yêu cầu tối đa một dự án |
| `service_project_members` | Phân công nhân sự (unique project+user, role LEAD/MEMBER) |
| `service_milestones` | Milestone + trạng thái + `completed_at` |
| `service_project_documents` | Tài liệu dự án, `visibility` CUSTOMER/INTERNAL |
| `service_project_messages` | Trao đổi; `is_internal_note` chỉ staff thấy |
| `service_project_events` | Lịch sử cập nhật; `is_internal` để ẩn sự kiện nội bộ với khách |

Phân biệt dịch vụ cần báo giá và sản phẩm thanh toán trực tiếp: `QUOTE_REQUIRED` hiển thị form yêu cầu; `DIRECT_CHECKOUT` trỏ tới một `Product` có sẵn và dẫn khách vào checkout hiện tại (không đụng vào luồng thanh toán/entitlement).

## API

Tất cả route gắn `@RequireFeature("services")` → 404 khi `FEATURE_SERVICES` tắt (mặc định tắt ở production).

| Nhóm | Endpoint | Quyền |
| :-- | :-- | :-- |
| Public | `GET /v1/services`, `GET /v1/services/:slug` | — |
| Public | `POST /v1/service-inquiries` (multipart, `files` ≤ 5 × 10 MB, chỉ khi đăng nhập) | tùy chọn đăng nhập |
| Khách | `GET /v1/me/service-inquiries`, `GET /v1/me/service-inquiries/:id`, `GET …/:id/attachments/:attachmentId/url` | đăng nhập + sở hữu |
| Khách | `GET /v1/me/service-projects`, `GET /v1/me/service-projects/:id`, `POST …/:id/messages`, `POST …/:id/documents`, `GET …/:id/documents/:documentId/url` | đăng nhập + sở hữu |
| Admin | `GET/POST /v1/admin/services`, `GET/PATCH /v1/admin/services/:id` | `service.read` / `service.manage` |
| Admin | `GET /v1/admin/service-inquiries`, `GET/PATCH …/:id`, `GET …/:id/attachments/:attachmentId/url` | `inquiry.read` / `inquiry.manage` |
| Admin | `POST /v1/admin/service-inquiries/:id/convert` | `inquiry.manage` + `project.manage` |
| Admin | `GET /v1/admin/service-projects`, `GET/PATCH …/:id`, `POST …/:id/members`, `DELETE …/:id/members/:userId`, `POST …/:id/milestones`, `PATCH …/:id/milestones/:milestoneId`, `POST …/:id/messages`, `POST …/:id/documents`, `GET …/:id/documents/:documentId/url` | `project.read` / `project.manage` |
| Admin | `GET /v1/admin/service-staff` | `project.manage` |

Quyền mới được gán: `support_agent` (inquiry.read/manage, project.read), `product_manager` (service.read/manage), `ops` (inquiry.read, project.read/manage), `admin` và `super_admin` (tất cả). Khách hàng không cần quyền mới: route khách chỉ dựa trên quyền sở hữu.

## Bảo mật

- **Phân quyền phía server**: admin qua `PermissionsGuard`; route khách lọc theo `userId` ngay trong truy vấn và kiểm tra lại bằng `canCustomerAccess*`. Bản ghi của khách khác trả **404** (không lộ sự tồn tại).
- **Chống IDOR**: mọi tài nguyên con (attachment, document, milestone) được tra theo cặp `(id, parentId)`; URL tải file chỉ ký sau khi kiểm tra quyền sở hữu và `visibility`.
- **Dữ liệu nội bộ**: ghi chú nội bộ, tài liệu INTERNAL, sự kiện nội bộ bị loại ở mức truy vấn và ở mapper; email nhân sự bị ẩn với khách. Khách không thể tạo ghi chú nội bộ hay tài liệu INTERNAL.
- **Form công khai**: DTO whitelist + giới hạn độ dài; honeypot `website`; rate limit Redis sliding window theo IP (5/giờ) và email (3/giờ), fail-closed 503 khi Redis lỗi; `submissionKey` chống gửi trùng; token sai bị 401 (không hạ cấp thành ẩn danh).
- **File**: MIME xác định bằng magic bytes (không tin client), whitelist PDF/PNG/JPEG/WebP/TXT/DOCX/XLSX/PPTX, ≤ 10 MB, tên file được làm sạch (kể cả khôi phục UTF-8 bị multipart decode sai), storage key do server sinh, object private + signed URL 120 giây. Upload lỗi giữa chừng sẽ dọn object mồ côi. Khách ẩn danh không được đính kèm file.
- **Toàn vẹn**: cập nhật trạng thái dùng compare-and-set (`updateMany where status = cũ`) → 409 khi xung đột; chuyển yêu cầu thành dự án trong một transaction, idempotent nhờ `inquiry_id` unique; audit log ghi trong cùng transaction với thay đổi.
- **Rate limit cho khách đã đăng nhập**: 30 tin nhắn/giờ, 20 lần tải tài liệu/giờ mỗi tài khoản.

## Tương thích với PR #23 (AI Marketing OS)

PR #23 thêm `Tenant`/`TenantMember` (ORGANIZATION/CLIENT) cho analytics và bật `multiSchema` (`schemas = ["public", "analytics"]`, mọi model gắn `@@schema("public")`).

- **Không dùng lại Tenant lúc này**: PR #23 chưa merge, `Tenant` chưa có trên `main`; ràng buộc schema của nó phục vụ analytics. Services Foundation cô lập dữ liệu theo **khách hàng (User)**, giống Orders/Tickets hiện tại.
- **Khi PR #23 được merge**: (1) thêm `@@schema("public")` cho 9 model và 9 enum Services (thay đổi chỉ là annotation, không đổi bảng vì đều ở `public`); (2) `User` model có xung đột text đơn giản (cả hai nhánh đều thêm back-relation) — giữ cả hai khối.
- **Hướng mở rộng tổ chức**: khi cần nhiều người của một doanh nghiệp cùng xem dự án, thêm cột nullable `tenant_id` vào `service_projects`/`service_inquiries` (additive) và mở rộng `canCustomerAccessProject` để chấp nhận thành viên tenant. Không cần đổi API khách.

## Hosting / Domain: đề xuất vô hiệu hóa kinh doanh (chưa thực hiện)

Không xóa module Hosting hay migration cũ. Đề xuất:

1. Giữ `FEATURE_HOSTING=false` ở mọi môi trường production (hiện đã là mặc định): API hosting trả 404, worker bỏ qua side-effect, Portal ẩn menu "Cloud Hosting".
2. Đặt các `Product` có `fulfillmentType = HOSTING_PROVISIONING` sang `ARCHIVED` để không còn hiển thị/bán (dữ liệu đơn cũ giữ nguyên).
3. Gỡ chữ "hosting" khỏi các nội dung bán hàng (ví dụ danh mục ticket "Cloud Hosting", placeholder ticket trong Portal) trong một PR riêng.
4. DNS, SSL, VPS, storage tiếp tục là hạ tầng kỹ thuật (Caddy, Cloudflare, R2) — không liên quan đến module Hosting.

## Vận hành

- Bật module: `FEATURE_SERVICES=true` (API). Storefront/Portal tự hiện menu qua `GET /v1/features`.
- Seed danh mục: `pnpm db:seed:services` (chỉ tạo nếu chưa có slug; production tạo ở trạng thái `DRAFT` để staff duyệt trước khi bật `ACTIVE`).
- Kiểm thử: `pnpm --filter @nexus/api test -- services`, `pnpm test:acceptance:services` (cần API đã build, Postgres, Redis, S3).
