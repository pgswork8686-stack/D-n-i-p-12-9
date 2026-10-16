# Technical review — PR #27 Services Foundation

| Mục | Giá trị |
|---|---|
| Ngày kiểm tra | 2026-10-16 (giờ máy kiểm tra, UTC+7) |
| Repository | `pgswork8686-stack/D-n-i-p-12-9` (public, default branch `main`, `main` có bật protection — chi tiết rule không đọc được: API trả 401 khi không có quyền admin) |
| `main` HEAD | `1237c8c736fd5ce6b888122a18132b6daf4d3909` (Merge PR #26) |
| PR #27 | `feat/services-foundation` → `main`, open, 16 commit, `mergeable: true`, `mergeable_state: clean` (kiểm lại sau lần push cuối, `main` không đổi) |
| PR #27 HEAD được review | `eec160a5e8706bb83b4ee947aa319dc6f62b7757` |
| HEAD trước vòng review này | `de08d7789b2278a6cbcb791d90ff4bbc3ca5d028` (CI 7/7 xanh — **không** dùng làm bằng chứng cho `eec160a`) |
| Phạm vi diff `main...eec160a` | 62 file, +8409 / −5 dòng (không xóa file nào; 5 dòng bị thay là dòng chỉnh sửa trong file hiện hữu) |
| Bằng chứng kiểm thử | [docs/qa/services-foundation-validation.md](../qa/services-foundation-validation.md) |

Báo cáo này đọc trực tiếp code, migration, contracts, test và frontend tại `eec160a`. Không suy luận từ mô tả PR.

---

## 1. Module inventory

| Lớp | Đường dẫn | Nội dung |
|---|---|---|
| Database | `packages/database/prisma/schema.prisma` (+9 model, +9 enum, back-relation trên `User`, `Product`) | `Service`, `ServiceInquiry`, `ServiceInquiryAttachment`, `ServiceProject`, `ServiceProjectMember`, `ServiceMilestone`, `ServiceProjectDocument`, `ServiceProjectMessage`, `ServiceProjectEvent` |
| Migration | `packages/database/prisma/migrations/20261015000000_20261015_services_foundation/migration.sql` | Tạo enum/bảng/index/FK mới |
| Domain | `packages/database/src/domain/service-engine.ts` | Ma trận chuyển trạng thái inquiry/project/milestone, kiểm tra sở hữu, visibility |
| Seed | `packages/database/src/service-seed.ts`, `seed.ts` | 6 dịch vụ (create-only, `DRAFT` ở production), 6 quyền RBAC mới |
| Contracts | `packages/contracts/src/services.ts` | DTO dùng chung, whitelist ngân sách/thời gian, giới hạn file |
| Feature flag | `packages/utils/src/feature-flags.ts` | `services` (tắt mặc định ở production) |
| API | `apps/api/src/modules/services/` (module, 8 controller, 3 service, file store, rate limiter, guard, mapper, retry helper) | 31 endpoint — xem [API matrix](../architecture/pgs-api-permissions-matrix.md) |
| SDK | `packages/sdk/src/client.ts` | 31 method + `requestJson`/`requestForm` |
| Storefront | `apps/web/app/services/**`, `components/site-header.tsx`, `lib/server-api.ts` | `/services`, `/services/[slug]`, form yêu cầu |
| Portal | `apps/portal/app/services/**`, `components/portal-shell.tsx` | `/services`, `/services/projects/[id]`, `/services/inquiries/[id]` |
| Admin | `apps/admin/app/services`, `service-inquiries/**`, `service-projects/**`, `components/services-nav.tsx`, `lib/permissions.ts` | danh mục, yêu cầu, dự án |
| Test | `apps/api/src/modules/services/*.spec.ts` (7 file), `apps/admin/app/__tests__/permissions.spec.ts`, `apps/web/app/__tests__/services-fetch.spec.ts`, `packages/sdk/src/client.spec.ts`, `packages/database/scripts/services-acceptance.ts` | unit + HTTP acceptance (69 gate) |
| CI | `.github/workflows/ci.yml` | thêm bước *Acceptance suite (Services Foundation)* |
| Docs | `docs/services-foundation.md`, `docs/deployment/environment-matrix.md`, `README.md`, `.env.production.example` | |

---

## 2. Database review

### 2.1 Tính additive

`migration.sql` chỉ có `CREATE TYPE`, `CREATE TABLE`, `CREATE [UNIQUE] INDEX` và `ALTER TABLE <bảng mới> ADD CONSTRAINT … FOREIGN KEY`. Không có `DROP`, không có `ALTER` trên bảng hiện hữu. Khóa ngoại trỏ tới `users`/`products` được khai báo **trên bảng mới**, không đổi cấu trúc `users`/`products`.

Đã kiểm chứng trên PostgreSQL 16 thật (chi tiết: QA §3):
- 23 migration cũ + migration mới chạy được trên DB trống và trên DB đang có dữ liệu.
- `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` trả 0 (schema và migration khớp, không drift).

### 2.2 Khóa, ràng buộc, chỉ mục

| Bảng | Unique | Index | FK → hành vi xóa |
|---|---|---|---|
| `services` | `slug` | `(status, sort_order)`, `product_id` | `product_id → products` **SET NULL** |
| `service_inquiries` | `inquiry_number`, `submission_key` | `user_id`, `service_id`, `status`, `contact_email`, `created_at` | `service_id → services` RESTRICT · `user_id → users` SET NULL · `reviewed_by_id → users` SET NULL |
| `service_inquiry_attachments` | `storage_key` | `inquiry_id` | `inquiry_id` CASCADE · `uploaded_by_id` SET NULL |
| `service_projects` | `project_code`, **`inquiry_id`** (1 dự án / 1 yêu cầu) | `customer_id`, `service_id`, `status`, `created_at` | `inquiry_id` SET NULL · `customer_id → users` **RESTRICT** · `service_id` RESTRICT · `created_by_id` SET NULL |
| `service_project_members` | `(project_id, user_id)` | `user_id` | `project_id` CASCADE · `user_id` CASCADE · `assigned_by_id` SET NULL |
| `service_milestones` | — | `(project_id, sort_order)` | `project_id` CASCADE |
| `service_project_documents` | `storage_key` | `project_id` | `project_id` CASCADE · `uploaded_by_id` SET NULL |
| `service_project_messages` | — | `(project_id, created_at)` | `project_id` CASCADE · `sender_id → users` **RESTRICT** |
| `service_project_events` | — | `(project_id, created_at)` | `project_id` CASCADE · `actor_id` SET NULL |

Mọi cột dùng SET NULL đều nullable. Cảnh báo `onDelete SetNull on a required field` của `prisma validate` có từ trước trên `main` (đã đối chiếu bằng cách validate schema của `main`), không do migration này gây ra.

### 2.3 Transaction, concurrency, idempotency

| Thao tác | Cơ chế | Vị trí |
|---|---|---|
| Gửi yêu cầu | `submission_key` UNIQUE; retry cùng key + cùng email trả lại yêu cầu gốc, khác email → 409; va chạm P2002 song song → trả yêu cầu của bên thắng | `service-inquiries.service.ts:127-189` |
| Mã `SI-`/`PRJ-` trùng | retry tối đa 3 lần với mã mới, chỉ khi P2002 đúng cột mã | `unique-code.ts`, `service-inquiries.service.ts:127, 336` |
| Đổi trạng thái inquiry/project/milestone | compare-and-set `updateMany where { id, status: <cũ> }` → 409 khi `count = 0` | `service-inquiries.service.ts`, `service-projects.service.ts` |
| Chuyển yêu cầu → dự án | 1 transaction: claim `QUALIFIED → CONVERTED` (CAS) + tạo project + event + audit; `inquiry_id` UNIQUE chặn dự án thứ hai; thua race → trả dự án đã tạo | `service-inquiries.service.ts:310-385` |
| Upload file | upload object trước → ghi DB trong transaction → lỗi thì xóa object mồ côi | `service-file-store.ts`, `service-inquiries.service.ts` |
| Audit | `logActionWithClient(tx, …)` trong cùng transaction với thay đổi; lỗi audit → rollback | toàn module |

### 2.4 Chiến lược rollback

Prisma không sinh migration *down*. Rollback theo thứ tự an toàn:

1. **Rollback chức năng (khuyến nghị, không đụng dữ liệu):** đặt `FEATURE_SERVICES=false`. Toàn bộ 31 route trả 404 (đã kiểm chứng bằng acceptance gate *"Every services route … returns 404 while the flag is off"*). Storefront/Portal ẩn menu.
2. **Rollback code:** revert merge commit của PR #27. Các bảng mới vẫn còn nhưng không được dùng; không ảnh hưởng Commerce/Order/Payment/License/Entitlement/Ticket vì không có FK nào từ bảng cũ trỏ vào bảng mới.
3. **Rollback schema (chỉ khi được duyệt, mất dữ liệu dịch vụ):** backup trước, sau đó xóa 9 bảng theo thứ tự con → cha (`service_project_events`, `service_project_messages`, `service_project_documents`, `service_milestones`, `service_project_members`, `service_projects`, `service_inquiry_attachments`, `service_inquiries`, `services`), xóa 9 enum `Service*`, và xóa dòng `20261015000000_20261015_services_foundation` khỏi `_prisma_migrations`. Object storage prefix `services/` cần dọn riêng.

### 2.5 Tương thích dữ liệu cũ

- Không có backfill, không có cột mới trên bảng cũ, không đổi enum cũ.
- Seed dịch vụ là *create-only* theo `slug` (không ghi đè chỉnh sửa của admin); ở production tạo `DRAFT`, bật flag không tự công khai dịch vụ chưa duyệt.
- Quyền RBAC mới chỉ được **thêm** vào `SEED_PERMISSIONS`/`ROLE_PERMISSION_MAP`; không mục nào bị xóa khỏi map. `seedSystemRbac` vốn đồng bộ theo map (thêm quyền mong muốn, thu hồi quyền không còn trong map), nên thay đổi này không làm mất quyền nào đang có trong map. Quyền cấp tay ngoài map (nếu có trên production) vẫn bị thu hồi như hành vi hiện tại của seed — không do PR này gây ra.

---

## 3. API review

31 endpoint, tất cả gắn `@RequireFeature("services")`. Bảng chi tiết input/output/lỗi/test: [pgs-api-permissions-matrix.md §2](../architecture/pgs-api-permissions-matrix.md).

| Nhóm | Xác thực | Phân quyền | Cô lập dữ liệu | Rate limit | Audit |
|---|---|---|---|---|---|
| Public catalog (`GET /v1/services`, `/:slug`) | không | — | chỉ `ACTIVE` | — | — |
| Public form (`POST /v1/service-inquiries`) | `OptionalAuthGuard` — có header thì phải hợp lệ (401), không có thì ẩn danh | — | `userId` lấy từ token, không từ body | Redis theo IP (5/h) và email (3/h), fail-closed 503 | `SERVICE_INQUIRY_SUBMITTED` |
| Khách (`/v1/me/service-*`) | `AuthGuard` | sở hữu (không cần permission) | lọc `userId`/`customerId` ngay trong truy vấn + `canCustomerAccess*`; bản ghi của người khác → 404 | tin nhắn 30/h, upload 20/h / tài khoản | `SERVICE_PROJECT_DOCUMENT_ADDED`; tin nhắn khách ghi project event |
| Admin (`/v1/admin/service*`) | `AuthGuard` | `PermissionsGuard` + `@RequirePermissions` trên **mọi** handler (kiểm bằng test metadata) | toàn cục theo quyền | — | mọi thao tác ghi |

Kiểm tra đối chiếu controller ↔ service ↔ DTO ↔ DB đã thực hiện cho từng endpoint. Không phát hiện endpoint nào thiếu guard, thiếu permission, nhận `storageKey`/`userId`/`status` nội bộ từ client, hoặc trả dữ liệu ngoài phạm vi sở hữu.

---

## 4. Security review (20 điểm bắt buộc)

| # | Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | A không xem yêu cầu của B | Đạt | Acceptance gate 27–29 (id, số yêu cầu, URL file → 404); unit `service-inquiries.service.spec.ts` "customer ownership (IDOR)" |
| 2 | A không xem dự án của B | Đạt | Gate 54–55; unit "returns 404 for a project owned by another customer" |
| 3 | Không tải file không thuộc quyền | Đạt | Gate 29, 53; unit "does not sign URLs for another customer's attachment", "…for internal documents, even for the owner" |
| 4 | Không có quyền admin không sửa dự án | Đạt | Gate 8, 31–32; `services.controllers.spec.ts` (guard + permission trên mọi handler admin) |
| 5 | Khách không sửa trạng thái nội bộ | Đạt | Không có endpoint khách nào nhận `status`; gate 56 (cờ `isInternalNote` của khách bị bỏ qua) |
| 6 | Khách không xem ghi chú nội bộ | Đạt | Gate 50; Playwright: DOM trang dự án phía khách không chứa nội dung ghi chú nội bộ (QA §6) |
| 7 | Khách không truy cập tài liệu INTERNAL | Đạt | Gate 51, 53, 57 (tài liệu khách tải lên luôn là CUSTOMER) |
| 8 | Không lộ email/định danh nội bộ nhân viên | Đạt (sau fix vòng trước) | `services.mappers.ts:38, 132, 206`; unit "never falls back to staff emails or exposes staff ids/event details"; gate 52 |
| 9 | Token sai không thành phiên ẩn danh | Đạt | `optional-auth.guard.ts:19`; gate 19; unit OptionalAuthGuard |
| 10 | Retry cùng idempotency key không tạo trùng | Đạt | Gate 11–12; unit "returns the original inquiry for a retried submissionKey", "maps a duplicate submissionKey race" |
| 11 | Một yêu cầu không thành hai dự án | Đạt | `inquiry_id` UNIQUE; gate 37–38; unit "is idempotent", "returns the winner's project" |
| 12 | Chuyển trạng thái sai bị từ chối | Đạt | Gate 33–34, 42, 59; `service-rules.spec.ts` |
| 13 | File sai định dạng bị từ chối | Đạt | Gate 22; `service-files.spec.ts` |
| 14 | Không tin MIME/tên file của client | Đạt | `service-files.ts:34` (magic bytes), `:72` (khôi phục UTF-8), `:121` (storage key do server sinh); gate 21 |
| 15 | Chống spam, rate limit hoạt động | Đạt (phụ thuộc cấu hình proxy — F-07) | Gate 17 (honeypot), 23 (429 sau 4 request/IP trong test); `inquiry-rate-limiter.spec.ts` |
| 16 | Redis lỗi → fail-closed | Đạt | `inquiry-rate-limiter.ts:88`; unit "fails closed with 503"; gate *"Public submissions fail closed with 503 when the rate limiter is unavailable"* (API thật, Redis không truy cập được) |
| 17 | File private không có URL công khai vĩnh viễn | Đạt | Object private; chỉ có signed URL |
| 18 | Signed URL có hạn, chỉ cấp sau kiểm tra quyền | Đạt | `service-file-store.ts:7` (120 s); gate 30 (`expiresInSeconds ≤ 300`) |
| 19 | Không SSRF | Đạt | Server không fetch URL nào do người dùng cung cấp. `imageUrl` chỉ được lưu (bắt buộc `https`, admin `service.manage`) và hiển thị bằng `<img>` phía trình duyệt, không qua image proxy của Next |
| 20 | Audit đủ và không lộ secret | Đạt | Audit trong cùng transaction; `details` chỉ chứa id/trạng thái/kích thước/sha256, không chứa nội dung yêu cầu, email khách hay token; `AuditService.sanitizeDetails` vẫn áp dụng; gate 61 |

---

## 5. Business logic review

- **Inquiry ≠ order ≠ project:** gửi yêu cầu chỉ tạo `ServiceInquiry`; không tạo order/payment/entitlement. Dự án chỉ sinh khi staff có `inquiry.manage` **và** `project.manage` chuyển một yêu cầu `QUALIFIED`.
- **Quyền sở hữu dự án:** là tài khoản đã gửi yêu cầu; với yêu cầu ẩn danh, admin phải chỉ định email của một tài khoản **đã tồn tại**. Hệ thống không tự liên kết theo email liên hệ (chưa xác minh).
- **Trạng thái kết thúc:** `CONVERTED`, `COMPLETED`, `CANCELLED` không thể đảo. Dự án đã đóng chặn mọi thao tác ghi của cả khách và staff.
- **DIRECT_CHECKOUT:** chỉ trỏ tới `Product` có sẵn và dẫn vào checkout hiện tại. Không có luồng giá/thanh toán mới; mọi invariant thanh toán (chỉ `PAID` qua webhook đã xác thực, giá do backend tính) giữ nguyên.
- **Không đụng** module thanh toán, license, entitlement, order (đã so diff: không file nào trong `apps/api/src/modules/{payments,orders,entitlements,licenses,downloads,cart}` và `apps/worker` bị sửa).

Khoảng trống nghiệp vụ (không phải lỗi, nằm ngoài phạm vi PR): chưa có thông báo khi có yêu cầu mới/cập nhật dự án; chưa lưu đồng ý xử lý dữ liệu cá nhân (consent) trên form — xem F-12.

---

## 6. Regression risk review

| Khu vực | Rủi ro | Kiểm chứng |
|---|---|---|
| Catalog, Cart, Checkout, SePay, Orders, Entitlements, Licenses, Downloads, CMS, Tickets, Worker, Automation | Không có file nào của các module này bị sửa; chỉ `app.module.ts` thêm `ServicesModule`, `schema.prisma` thêm back-relation | Acceptance phase 4→18 + worker smoke chạy lại trên `eec160a` (QA §4) |
| Header Storefront | thêm mục "Dịch vụ" có điều kiện theo `/v1/features` | Ẩn khi flag tắt; Playwright 1440/768/390 |
| Portal shell | thêm mục "Service Projects" theo flag | Ẩn khi flag tắt |
| Khởi động API | constructor `ServiceInquiriesService` ném lỗi nếu production + flag bật + thiếu salt | Không ném khi flag tắt (unit test 3 trường hợp) — deploy hiện tại không bị ảnh hưởng |
| Bộ nhớ/băng thông | upload công khai | F-01 đã sửa; F-08 còn mở ở mức hạ tầng |

---

## 7. Danh sách phát hiện

Thang mức độ: **P0** mất dữ liệu/lộ dữ liệu diện rộng/không thể deploy · **P1** lỗ hổng bảo mật hoặc sẵn sàng có thể khai thác, sai nghiệp vụ quan trọng · **P2** lỗi chức năng/UX có tác động thật, rủi ro có điều kiện · **P3** cải thiện, nợ kỹ thuật.

### Phát hiện trong vòng review này (trên `de08d77` → sửa tới `eec160a`)

#### F-01 — Upload ẩn danh bị buffer vào RAM trước khi bị từ chối
- **Severity:** P1 (availability)
- **File + line:** `apps/api/src/modules/services/services.controllers.ts:108` (trước khi sửa: `FilesInterceptor` không có `fileFilter`); kiểm tra người gửi ở `service-inquiries.service.ts:99`.
- **Evidence:** Nest chạy interceptor (Multer, memory storage) trước handler. Multer đọc toàn bộ tới 5 file × 10 MB vào RAM, sau đó handler mới trả 400 vì người gửi ẩn danh. Bước rate limit (`:121`) nằm **sau** kiểm tra này, nên request bị từ chối không bị tính quota.
- **Root cause:** kiểm tra quyền đính kèm đặt ở service thay vì ở tầng parse multipart.
- **Impact:** bất kỳ ai cũng có thể gửi liên tục request 50 MB tới endpoint công khai mà không bị giới hạn, gây áp lực bộ nhớ lên toàn bộ API (kể cả Marketplace) khi bật flag.
- **Proposed fix:** từ chối file part ngay tại Multer khi chưa đăng nhập.
- **Actual fix:** `signedInOnlyFileFilter` (`services.controllers.ts:58`), gắn vào interceptor tại `:108`. `OptionalAuthGuard` chạy trước interceptor nên `req.user` đã có. Commit `a7ece72`.
- **Test evidence:** unit `services.controllers.spec.ts` "signedInOnlyFileFilter (public inquiry uploads)"; acceptance gate 18 "Anonymous attachments are refused (400)".
- **Status:** FIXED

#### F-02 — Trùng mã `SI-`/`PRJ-` trả lỗi 500
- **Severity:** P2
- **File + line:** `service-inquiries.service.ts:127`, `:336` (trước khi sửa: một lần `generateTicketNumber`).
- **Evidence:** `generateTicketNumber` sinh `PREFIX-YYYYMM-XXXXXX` với 3 byte ngẫu nhiên (≈16,7 triệu giá trị/tháng). Theo nghịch lý ngày sinh, xác suất trùng đáng kể khi số bản ghi trong tháng lên mức vài nghìn (ví dụ khi bị spam qua nhiều IP). P2002 trên `inquiry_number`/`project_code` không được xử lý → 500.
- **Root cause:** không có retry cho mã hiển thị.
- **Impact:** người dùng nhận lỗi 500 hiếm gặp; không mất dữ liệu (transaction rollback).
- **Actual fix:** `withUniqueCodeRetry` (`unique-code.ts`), chỉ retry khi vi phạm đúng cột mã, tối đa 3 lần. Commit `2851e89`.
- **Test evidence:** `unique-code.spec.ts` (4 test).
- **Status:** FIXED

#### F-03 — Portal `/services` tràn ngang ở 768 px
- **Severity:** P2
- **File + line:** `apps/portal/app/services/page.tsx:90, 101, 154`.
- **Evidence:** Playwright đo `scrollWidth = 809` ở viewport 768 (QA §6, lượt `a7ece72`). Phần tử vượt khung: card dự án rộng 521 px trong vùng nội dung ~464 px.
- **Root cause:** lưới `grid` không khai báo cột → cột ngầm định co giãn theo `min-content` của tiêu đề `truncate`.
- **Actual fix:** `grid-cols-1` (= `minmax(0,1fr)`), card xếp dọc dưới `lg`; các layout chi tiết ở portal/admin/web dùng `minmax(0,1fr)`. Commit `eec160a`.
- **Test evidence:** Playwright lượt `eec160a`: 24/24 kiểm tra không tràn ngang ở 1440/768/390.
- **Status:** FIXED

#### F-04 — Storefront coi sự cố API như "danh mục trống" hoặc 404
- **Severity:** P2
- **File + line:** `apps/web/app/lib/server-api.ts:68, 76`.
- **Evidence:** trước khi sửa, `listServices` trả `[]` khi 5xx/mất mạng ("Danh mục đang được cập nhật") và `getService` trả `null` → `notFound()`.
- **Impact:** sự cố hệ thống hiển thị sai thành trang trống/404, không cho thử lại.
- **Actual fix:** 404 → `null` (module tắt/không tồn tại); 5xx/mất mạng → throw → `error.tsx`; metadata có fallback; thêm `services/loading.tsx`. Commit `a7ece72`.
- **Test evidence:** `apps/web/app/__tests__/services-fetch.spec.ts` (6 test).
- **Status:** FIXED

#### F-05 — Admin không ẩn/khóa thao tác theo quyền, thiếu xác nhận cho thao tác không đảo ngược
- **Severity:** P2 (yêu cầu UX do chủ dự án nêu; backend đã enforce quyền nên **không** phải lỗ hổng)
- **File + line:** `apps/admin/app/lib/permissions.ts`; các trang `apps/admin/app/services/page.tsx`, `service-inquiries/[id]/page.tsx`, `service-projects/[id]/page.tsx`.
- **Actual fix:** `useCan()`/`hasPermissions` mô phỏng `PermissionsGuard` (super_admin pass; còn lại cần **tất cả** quyền, ví dụ convert cần `inquiry.manage` + `project.manage`); xác nhận trước khi convert, đánh dấu REJECTED/SPAM, đóng dự án, gỡ nhân sự, chia sẻ tài liệu cho khách. Dùng `window.confirm` cho tới khi `Dialog` của B1 được merge. Commit `aa7887d`.
- **Test evidence:** `apps/admin/app/__tests__/permissions.spec.ts` (6 test).
- **Status:** FIXED

#### F-06 — Tải file bằng `window.open` sau `await` có thể bị chặn như popup
- **Severity:** P3
- **Actual fix:** `window.location.assign(url)` (signed URL trả `Content-Disposition: attachment`). Portal 2 chỗ, admin 2 chỗ. Commit `a7ece72`.
- **Status:** FIXED

#### F-07 — Rate limit theo IP phụ thuộc số proxy trước API
- **Severity:** P1 (điều kiện bật tính năng ở production — không phải lỗi code trong PR)
- **File + line:** `apps/api/src/main.ts:25` (`trust proxy = 1`, có từ trước PR); dùng tại `service-inquiries.service.ts:120`.
- **Evidence:** `req.ip` lấy từ `X-Forwarded-For` theo số hop tin cậy. Nếu API nhận request trực tiếp (0 proxy), client tự đặt `X-Forwarded-For` để né giới hạn theo IP; nếu có ≥2 proxy (ví dụ Cloudflare + Caddy), mọi request mang IP của proxy và dùng chung một quota.
- **Impact:** giới hạn theo IP có thể vô hiệu hoặc chặn nhầm. Giới hạn theo email (3/h) vẫn hoạt động.
- **Proposed fix:** xác nhận topology production; cấu hình `trust proxy` theo số hop thực tế hoặc dải IP của proxy (thay đổi dùng chung cho mọi module → PR riêng), và chặn truy cập trực tiếp vào cổng API.
- **Status:** OPEN — chờ chủ dự án xác nhận topology. Không chặn merge vì flag tắt mặc định; **chặn việc bật `FEATURE_SERVICES` ở production**.

#### F-08 — Request body công khai vẫn được nhận qua mạng
- **Severity:** P2 (hạ tầng)
- **Evidence:** F-01 dừng buffer RAM cho người ẩn danh, nhưng Express vẫn nhận phần body còn lại qua mạng. Khách đã đăng nhập có thể gửi tới 50 MB/request trước khi bị rate limit.
- **Proposed fix:** giới hạn kích thước body ở reverse proxy cho `/v1/service-inquiries` và `/v1/me/service-projects/*/documents` (ví dụ chỉ thị `request_body max_size` của Caddy), cùng rate limit ở edge.
- **Status:** OPEN (hạ tầng)

#### F-09 — 409 khi dùng lại `submissionKey` với email khác cho biết key đã tồn tại
- **Severity:** P3
- **File + line:** `service-inquiries.service.ts:189`
- **Impact:** không đáng kể vì key là UUIDv4 do trình duyệt sinh, không đoán được.
- **Status:** ACCEPTED (ghi nhận)

#### F-10 — FK `RESTRICT` từ dự án/tin nhắn tới `users`
- **Severity:** P3
- **File + line:** `migration.sql:283, 313`
- **Evidence:** hiện không có luồng xóa cứng user (tìm `user.delete`/`deleteMany` trong `apps/api`, `apps/worker`, `packages/database/src` — không có). `tickets.user_id` cũng `RESTRICT` (`schema.prisma`, model `Ticket`).
- **Impact:** nếu sau này thêm xóa/ẩn danh hóa tài khoản, cần xử lý dữ liệu dự án trước.
- **Status:** ACCEPTED — ghi vào backlog quyền riêng tư dữ liệu.

#### F-11 — Một số điểm UI nhỏ
- **Severity:** P3
- **Evidence:** lịch sử ở admin hiển thị tên enum thô (`apps/admin/app/service-projects/[id]/page.tsx:422`); portal lấy tối đa 50 dự án/yêu cầu, chưa phân trang (`apps/portal/app/services/page.tsx:33-34`); `assignMember` gọi đồng thời cho cùng một nhân sự có thể gặp P2002 → 500 (`service-projects.service.ts:292`).
- **Status:** PARTIALLY FIXED — `assignMember` race đã sửa ở commit `f2bf30a` (retry một lần khi P2002; test "retries once when a concurrent assignment wins the insert race" và "does not swallow non-unique database errors"). Hai điểm UI (tên enum thô, phân trang portal) còn OPEN (backlog Sprint 1).

#### F-12 — Chưa lưu consent và chưa có thông báo
- **Severity:** P2 (quyết định sản phẩm/pháp lý)
- **Evidence:** `CreateServiceInquiryDto` không có trường đồng ý xử lý dữ liệu; đề xuất P3 của B2 (`docs/frontend/backend-proposals.md`) có `consent`. Không phát outbox event khi có yêu cầu mới (worker hiện ném lỗi với loại event lạ — `apps/worker/src/outbox-processor.ts`).
- **Proposed fix:** chủ dự án/pháp chế quyết định yêu cầu về consent; nếu cần, thêm cột `consent_version`, `consent_at` (additive) trước khi bật form trên production. Thông báo: thêm event `SERVICE_INQUIRY_CREATED` + handler worker trong PR riêng.
- **Status:** OPEN — cần quyết định của chủ dự án.

### Phát hiện đã sửa ở vòng trước (trước `de08d77`, ghi lại để truy vết)

| ID | Severity | Nội dung | Commit |
|---|---|---|---|
| H-01 | P1 | Tên nhân viên phía khách rơi về email khi chưa có display name | `de08d77` |
| H-02 | P2 | Event phân công trả `userId` nội bộ cho khách | `de08d77` |
| H-03 | P2 | Tin nhắn/ghi chú nội bộ của staff không ghi audit | `de08d77` |
| H-04 | P2 | Salt băm IP có giá trị mặc định cố định | `de08d77` |
| H-05 | P3 | Staff vẫn ghi được vào dự án đã đóng | `de08d77` |
| H-06 | P2 | Tên file tiếng Việt bị decode latin1 (mojibake) | `1a3c9e7` |

---

## 8. Fix đã thực hiện trong vòng này

| Commit | Nội dung |
|---|---|
| `2851e89` | F-02 + unit test rate limiter (429, short-circuit, fail-closed 503) |
| `aa7887d` | F-05 |
| `ba46eac` | Acceptance: flag tắt → 404 toàn bộ route; Redis không truy cập được → 503, không lưu dữ liệu (69 gate) |
| `a7ece72` | F-01, F-04, F-06 |
| `eec160a` | F-03 |

## 9. Fix chưa thực hiện

F-07 (topology proxy), F-08 (giới hạn body ở reverse proxy), F-11 (UI nhỏ), F-12 (consent/thông báo — cần quyết định). F-09, F-10 được chấp nhận và ghi backlog.

## 10. Merge recommendation

**`APPROVE_TO_MERGE`** cho code của PR #27 tại `eec160a5e8706bb83b4ee947aa319dc6f62b7757`.

Căn cứ (đều trên đúng SHA này):
- Không còn P0. Các P1 nằm trong code (F-01 vòng này, H-01 vòng trước) đã sửa và có test.
- GitHub Actions run [`38773363853`](https://github.com/pgswork8686-stack/D-n-i-p-12-9/actions/runs/38773363853) xanh 7/7. PR `mergeable: true`, `mergeable_state: clean` (kiểm lại sau lần push cuối). `main` vẫn là `1237c8c`.
- Kiểm chứng cục bộ:
  - lint 11/11, typecheck 17/17;
  - unit 845/845;
  - 24 migration, không drift;
  - acceptance phase 4→18 (949 gate) và Services (69 gate);
  - worker smoke;
  - 6 Docker image;
  - Playwright 33/33.
  
  Chi tiết: [QA](../qa/services-foundation-validation.md).
- PR không sửa file nào của các module Commerce/Payment/License/Entitlement/Download/Ticket/Worker. Toàn bộ tính năng nằm sau `FEATURE_SERVICES` (tắt mặc định ở production), nên merge không làm thay đổi hành vi production.

Khuyến nghị này **chỉ đánh giá code và điều kiện review**. Trạng thái hiện tại là `CODE_MERGE_READY`, **chưa** `STAGING_VERIFIED` hay `PRODUCTION_VERIFIED`.

**Điều kiện trước khi bật `FEATURE_SERVICES` ở production (không chặn merge):**
1. F-07: xác nhận topology proxy và cấu hình `trust proxy` tương ứng.
2. Đặt `SERVICE_INQUIRY_IP_SALT` (API dừng khởi động nếu thiếu khi flag bật).
3. F-12: quyết định về consent và kênh thông báo yêu cầu mới.
4. F-08: giới hạn kích thước request body ở reverse proxy.
5. Staff duyệt và chuyển các dịch vụ seed từ `DRAFT` sang `ACTIVE`.
6. Chạy acceptance Services trên staging (Supabase thật, R2 thật).
