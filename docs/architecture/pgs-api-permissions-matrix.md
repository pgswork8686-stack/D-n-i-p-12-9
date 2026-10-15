# PGS — API & Permission Matrix

| Mục | Giá trị |
|---|---|
| Ngày | 2026-10-16 |
| Nguồn | trích tự động từ decorator NestJS (`@Controller`, `@Get/@Post/…`, `@UseGuards`, `@RequirePermissions`, `@RequireFeature`, `@Body`) tại `eec160a` (PR #27) — script [`docs/qa/scripts/extract-routes.mjs`](../qa/scripts/extract-routes.mjs), cách trích xuất ở §5 |
| Tổng | **202 route** trong 49 controller: 171 route đã có trên `main` + 31 route của PR #27 |

Ba nhóm được tách rõ:

1. **ĐÃ CÓ** trên `main` (`1237c8c`) — §4.
2. **TRONG PR #27** (`feat/services-foundation` @ `eec160a`, chưa merge) — §2.
3. **ĐỀ XUẤT** trong [RFC Unified Quotation](unified-quotation-rfc.md), chưa có code — §3.

Quy ước "Actor": *Public* (không cần đăng nhập) · *Đã đăng nhập (sở hữu)* (`AuthGuard`, dữ liệu lọc theo chủ sở hữu, bản ghi người khác trả 404) · *Staff* (`AuthGuard` + `PermissionsGuard`; `super_admin` pass mọi kiểm tra) · *Hệ thống (HMAC)* (n8n gọi vào, `AutomationHmacGuard`).

---

## 1. Tóm tắt quyền theo vai trò (sau PR #27)

| Quyền | customer | support_agent | content_editor | product_manager | finance | ops | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `service.read` / `service.manage` | | | | ✓ / ✓ | | | ✓ / ✓ | ✓ |
| `inquiry.read` / `inquiry.manage` | | ✓ / ✓ | | | | ✓ / – | ✓ / ✓ | ✓ |
| `project.read` / `project.manage` | | ✓ / – | | | | ✓ / ✓ | ✓ / ✓ | ✓ |
| (đề xuất) `quote.read` / `quote.manage` / `quote.approve` | | ✓ / ✓ / – | | ✓ / – / – | ✓ / – / ✓ | ✓ / – / – | ✓ | ✓ |
| (đề xuất) `contract.manage` / `billing.manage` | | | | | – / ✓ | ✓ / – | ✓ | ✓ |

Quyền hiện có trước PR #27 (`profile.*`, `user.*`, `product.*`, `order.*`, `entitlement.*`, `license.*`, `content.*`, `ticket.*`, `finance.*`, `invoice.read`, `audit.read`, `payment.*`, `settings.manage`, `automation.*`, `affiliate.*`, `subscription.*`, `hosting.*`, `notification.*`) không đổi — nguồn: `packages/database/src/seed.ts`.

---

## 2. TRONG PR #27 — Services Foundation (31 route, tất cả `@RequireFeature("services")`)

Lỗi chung cho mọi route: **404 khi `FEATURE_SERVICES` tắt** (kiểm bằng acceptance gate 65). "Gate n" = gate trong `packages/database/scripts/services-acceptance.ts` (QA §5.1).

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/services` | GET | Public | — | — | `ServiceDto[]` (chỉ `ACTIVE`) | — | gate 1; unit catalog |
| `/v1/services/:slug` | GET | Public | — | slug | `ServiceDto` | 404 (không tồn tại / không `ACTIVE`) | gate 2, 3, 5 |
| `/v1/service-inquiries` | POST | Public / đã đăng nhập | — (token sai → 401) | `CreateServiceInquiryDto` (multipart; `files` ≤ 5 × 10 MB chỉ khi đăng nhập) | `201 { inquiryNumber, status }` | 400 (DTO, file, ẩn danh đính kèm), 401, 404 (dịch vụ), 409 (`submissionKey` khác email), 429, 503 | gate 9–23, 67–68; unit inquiries, files, rate limiter, controllers |
| `/v1/me/service-inquiries` | GET | Đã đăng nhập (sở hữu) | — | `page`, `limit` | `PaginatedList<ServiceInquiryDto>` | 401 | gate 24–26 |
| `/v1/me/service-inquiries/:id` | GET | Đã đăng nhập (sở hữu) | — | id hoặc `SI-…` | `ServiceInquiryDto` | 401, 404 (không sở hữu) | gate 27–28 |
| `/v1/me/service-inquiries/:id/attachments/:attachmentId/url` | GET | Đã đăng nhập (sở hữu) | — | — | `{ url, expiresInSeconds: 120 }` | 401, 404 | gate 29–30 |
| `/v1/me/service-projects` | GET | Đã đăng nhập (sở hữu) | — | `page`, `limit` | `PaginatedList<ServiceProjectSummaryDto>` | 401 | unit "scopes the customer project list" |
| `/v1/me/service-projects/:id` | GET | Đã đăng nhập (sở hữu) | — | id hoặc `PRJ-…` | `ServiceProjectDto` (không có ghi chú/tài liệu/sự kiện nội bộ, không email/id nhân sự) | 401, 404 | gate 49–52, 54; Playwright |
| `/v1/me/service-projects/:id/messages` | POST | Đã đăng nhập (sở hữu) | — | `PostProjectMessageDto` (`isInternalNote` bị bỏ qua) | `ServiceProjectDto` | 400 (rỗng, dự án đã đóng), 401, 404, 429 (30/h), 503 | gate 55–56, 60 |
| `/v1/me/service-projects/:id/documents` | POST | Đã đăng nhập (sở hữu) | — | multipart `file` (luôn lưu `CUSTOMER`) | `ServiceProjectDto` | 400, 401, 404, 429 (20/h), 503 | gate 57; unit |
| `/v1/me/service-projects/:id/documents/:documentId/url` | GET | Đã đăng nhập (sở hữu) | — | — | `{ url, expiresInSeconds }` | 401, 404 (kể cả tài liệu `INTERNAL`) | gate 53 |
| `/v1/admin/services` | GET | Staff | `service.read` | `status`, `search`, `page`, `limit` | `PaginatedList<ServiceDto>` | 401, 403 | controllers spec |
| `/v1/admin/services/:id` | GET | Staff | `service.read` | — | `ServiceDto` | 401, 403, 404 | controllers spec |
| `/v1/admin/services` | POST | Staff | `service.manage` | `CreateServiceDto` | `201 ServiceDto` | 400 (`DIRECT_CHECKOUT` thiếu product), 401, 403, 409 (slug) | gate 4, 6, 8 |
| `/v1/admin/services/:id` | PATCH | Staff | `service.manage` | `UpdateServiceDto` | `ServiceDto` | 400, 401, 403, 404, 409 | gate 7 |
| `/v1/admin/service-inquiries` | GET | Staff | `inquiry.read` | `status`, `serviceId`, `search`, `page`, `limit` | `PaginatedList<AdminServiceInquiryDto>` | 401, 403 | gate 31 |
| `/v1/admin/service-inquiries/:id` | GET | Staff | `inquiry.read` | — | `AdminServiceInquiryDto` | 401, 403, 404 | Playwright |
| `/v1/admin/service-inquiries/:id/attachments/:attachmentId/url` | GET | Staff | `inquiry.read` | — | `{ url, expiresInSeconds }` | 401, 403, 404 | unit |
| `/v1/admin/service-inquiries/:id` | PATCH | Staff | `inquiry.manage` | `AdminUpdateInquiryDto` | `AdminServiceInquiryDto` | 400 (chuyển sai, `CONVERTED` thủ công), 401, 403, 404, 409 (CAS) | gate 33, 35; unit adminUpdate |
| `/v1/admin/service-inquiries/:id/convert` | POST | Staff | `inquiry.manage` **+** `project.manage` | `ConvertInquiryDto` | `201 AdminServiceProjectDto` (idempotent) | 400 (không `QUALIFIED`, thiếu tài khoản cho yêu cầu ẩn danh), 401, 403, 404, 409 | gate 32, 34, 36–41 |
| `/v1/admin/service-projects` | GET | Staff | `project.read` | `status`, `serviceId`, `search`, `page`, `limit` | `PaginatedList<summary + customerEmail>` | 401, 403 | Playwright |
| `/v1/admin/service-projects/:id` | GET | Staff | `project.read` | — | `AdminServiceProjectDto` | 401, 403, 404 | Playwright |
| `/v1/admin/service-projects/:id` | PATCH | Staff | `project.manage` | `AdminUpdateProjectDto` | `AdminServiceProjectDto` | 400 (chuyển sai, ngày), 401, 403, 404, 409 | gate 42–43, 58–59 |
| `/v1/admin/service-projects/:id/members` | POST | Staff | `project.manage` | `AssignProjectMemberDto` | `201 AdminServiceProjectDto` | 400 (không phải staff), 401, 403, 404 | gate 44–45 |
| `/v1/admin/service-projects/:id/members/:userId` | DELETE | Staff | `project.manage` | — | `AdminServiceProjectDto` | 401, 403, 404 | unit |
| `/v1/admin/service-projects/:id/milestones` | POST | Staff | `project.manage` | `CreateMilestoneDto` | `201 AdminServiceProjectDto` | 400 (dự án đã đóng), 401, 403, 404 | gate 46 |
| `/v1/admin/service-projects/:id/milestones/:milestoneId` | PATCH | Staff | `project.manage` | `UpdateMilestoneDto` | `AdminServiceProjectDto` | 400, 401, 403, 404, 409 | gate 47; unit |
| `/v1/admin/service-projects/:id/messages` | POST | Staff | `project.manage` | `PostProjectMessageDto` (cho phép ghi chú nội bộ) | `201 AdminServiceProjectDto` | 400 (dự án đã đóng), 401, 403, 404 | unit (audit ghi chú nội bộ) |
| `/v1/admin/service-projects/:id/documents` | POST | Staff | `project.manage` | multipart `file` + `visibility` | `201 AdminServiceProjectDto` | 400, 401, 403, 404 | gate 48 |
| `/v1/admin/service-projects/:id/documents/:documentId/url` | GET | Staff | `project.read` | — | `{ url, expiresInSeconds }` | 401, 403, 404 | unit |
| `/v1/admin/service-staff` | GET | Staff | `project.manage` | — | `StaffUserDto[]` | 401, 403 | gate 45 |

`GET /v1/services` và `GET /v1/services/:slug` còn có alias không phiên bản `/services`, `/services/:slug` (cùng flag; gate 65 kiểm `/services` trả 404 khi tắt).

---

## 3. ĐỀ XUẤT — Unified Quotation (chưa có code)

Tất cả dự kiến gắn `@RequireFeature("quotations")`. Chi tiết nghiệp vụ: [RFC §6–§8](unified-quotation-rfc.md).

| API | Method | Actor | Permission | Input | Output | Errors | Test (dự kiến) |
|---|---|---|---|---|---|---|---|
| `/v1/quote-requests` | POST | Public/đã đăng nhập (D-8) | — | `{ items[], company, contact, message, submissionKey, website }` | `201 { requestNumber }` | 400, 401, 404, 409, 429, 503 | acceptance: spam, idempotency |
| `/v1/me/quote-requests` | GET | sở hữu | — | page | list | 401 | IDOR |
| `/v1/me/quote-requests/:id` | GET | sở hữu | — | — | chi tiết | 401, 404 | IDOR |
| `/v1/me/quotations` | GET | sở hữu | — | page | list (chỉ phiên bản đã gửi) | 401 | IDOR |
| `/v1/me/quotations/:id` | GET | sở hữu | — | — | phiên bản đang mở + lịch sử (lần đầu → `VIEWED`) | 401, 404 | không lộ DRAFT/approval |
| `/v1/me/quotations/:id/versions/:versionId/pdf-url` | GET | sở hữu | — | — | `{ url, expiresInSeconds }` / 202 khi đang sinh | 401, 404 | signed URL |
| `/v1/me/quotations/:id/accept` | POST | sở hữu | — | `{ versionId, snapshotHash, acceptTerms }` | phiên bản `ACCEPTED` | 400, 401, 404, 409 (hash/đã đổi), 410/409 (quá hạn) | stale hash, idempotent |
| `/v1/me/quotations/:id/reject` | POST | sở hữu | — | `{ versionId, reason? }` | phiên bản `REJECTED` | 401, 404, 409 | |
| `/v1/me/quotations/:id/checkout` | POST | sở hữu | — | — | `{ orderId }` (đơn hàng số từ snapshot) | 401, 404, 409 (chưa ACCEPTED) | regression phase 4/5/9 |
| `/v1/admin/quote-requests` | GET | Staff | `quote.read` | filter | list | 401, 403 | RBAC |
| `/v1/admin/quote-requests/:id` | PATCH | Staff | `quote.manage` | `{ status, assignedToId }` | chi tiết | 400, 403, 404, 409 | |
| `/v1/admin/service-inquiries/:id/quote-request` | POST | Staff | `quote.manage` + `inquiry.read` | — | `201` quote request (idempotent theo inquiry) | 403, 404, 409 | |
| `/v1/admin/quotations` | POST / GET | Staff | `quote.manage` / `quote.read` | `{ quoteRequestId, currency }` / filter | quotation | 400, 403, 404 | |
| `/v1/admin/quotations/:id` | GET | Staff | `quote.read` | — | đầy đủ (gồm nội bộ) | 403, 404 | |
| `/v1/admin/quotations/:id/versions/:versionId` | PUT | Staff | `quote.manage` | hạng mục, điều khoản, `validUntil`, `updatedAt` (CAS) | phiên bản DRAFT | 400, 403, 404, 409 (không còn DRAFT / CAS) | |
| `/v1/admin/quotations/:id/versions/:versionId/submit` | POST | Staff | `quote.manage` | — | INTERNAL_REVIEW | 403, 409, 422 (thiếu tax profile) | ma trận chuyển trạng thái |
| `…/approve`, `…/request-changes` | POST | Staff | `quote.approve` | `{ note }` | approval | 403, 409 | 4-eyes (D-2) |
| `…/send`, `…/withdraw` | POST | Staff | `quote.manage` | — / `{ reason }` | SENT / CANCELLED | 403, 409 | outbox `QUOTATION_SENT` |
| `/v1/admin/quotations/:id/revise` | POST | Staff | `quote.manage` | — | phiên bản DRAFT mới | 403, 409 | SUPERSEDED |
| `/v1/admin/quotations/:id/contract` | POST | Staff | `contract.manage` | `{ serviceProjectId? }` | hợp đồng | 403, 409 | |
| `/v1/admin/contracts/:id` | PATCH | Staff | `contract.manage` | trạng thái, ngày ký, file | hợp đồng | 403, 404, 409 | |
| `/v1/admin/contracts/:id/billing-schedules/:sid/issue-order` | POST | Staff | `billing.manage` | — | `{ orderId }` (idempotent theo đợt) | 403, 404, 409 | worker `ORDER_PAID` → `PAID` |

---

## 4. ĐÃ CÓ trên `main` (171 route)

Bảng sinh tự động từ code tại `eec160a` (các file này không bị PR #27 sửa). Cột **Output** dẫn tới handler để đọc kiểu trả về chính xác. Cột **Errors** chỉ liệt kê lỗi do guard/flag/DTO gây ra; lỗi nghiệp vụ nằm trong service tương ứng. Cột **Test** ghi bộ test bao phủ module (unit trong `apps/api/src/modules/<module>/*.spec.ts`, acceptance theo phase — xem [QA §5.2](../qa/services-foundation-validation.md)).

Các route không có guard ở controller được xác thực theo cách khác: webhook thanh toán xác thực chữ ký/API key trong handler; license/update dùng license key; `POST /v1/payments/test-callback` chỉ hoạt động khi bật cổng test (bị cấm ở production).

#### affiliates (11 route · unit: 1 file spec · acceptance: phase 13)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/affiliates` (alias `/admin/affiliates`) | GET | Staff | `affiliate.read` | — | xem [listAffiliates](../../apps/api/src/modules/affiliates/admin-affiliates.controller.ts#L36) | 400 (DTO), 401, 403, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/admin/affiliates/:id/status` (alias `/admin/affiliates/:id/status`) | PATCH | Staff | `affiliate.manage` | `AdminUpdateAffiliateStatusDto` | xem [updateStatus](../../apps/api/src/modules/affiliates/admin-affiliates.controller.ts#L44) | 400 (DTO), 401, 403, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/admin/affiliates/:id/commission` (alias `/admin/affiliates/:id/commission`) | PATCH | Staff | `affiliate.manage` | `AdminUpdateCommissionDto` | xem [updateCommission](../../apps/api/src/modules/affiliates/admin-affiliates.controller.ts#L53) | 400 (DTO), 401, 403, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/admin/affiliates/payouts` (alias `/admin/affiliates/payouts`) | GET | Staff | `affiliate.read` | — | xem [listPayouts](../../apps/api/src/modules/affiliates/admin-affiliates.controller.ts#L62) | 400 (DTO), 401, 403, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/admin/affiliates/payouts/:id/process` (alias `/admin/affiliates/payouts/:id/process`) | POST | Staff | `affiliate.manage` | `AdminProcessPayoutDto` | xem [processPayout](../../apps/api/src/modules/affiliates/admin-affiliates.controller.ts#L68) | 400 (DTO), 401, 403, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/register` (alias `/affiliates/register`) | POST | Đã đăng nhập (sở hữu) | — | `RegisterAffiliateDto` | xem [register](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L36) | 400 (DTO), 401, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/me` (alias `/affiliates/me`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getDashboard](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L46) | 400 (DTO), 401, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/click` (alias `/affiliates/click`) | POST | Public | — | `RecordClickDto` | xem [recordClick](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L53) | 400 (DTO), 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/payouts` (alias `/affiliates/payouts`) | POST | Đã đăng nhập (sở hữu) | — | `RequestPayoutDto` | xem [requestPayout](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L63) | 400 (DTO), 401, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/payouts` (alias `/affiliates/payouts`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listPayouts](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L73) | 400 (DTO), 401, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |
| `/v1/affiliates/referrals` (alias `/affiliates/referrals`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listReferrals](../../apps/api/src/modules/affiliates/affiliates.controller.ts#L80) | 400 (DTO), 401, 404 khi FEATURE_AFFILIATE tắt | unit module · phase 13 |

#### allocations (14 route · unit: 2 file spec · acceptance: phase 6)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/license-providers` | GET | Staff | `license.read` | — | xem [listProviders](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L41) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/provider-accounts` | GET | Staff | `license.read` | — | xem [listProviderAccounts](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L51) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/provider-accounts` | POST | Staff | `license.manage` | `CreateProviderAccountDto` | xem [createProviderAccount](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L59) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/provider-accounts/:id` | GET | Staff | `license.read` | — | xem [getProviderAccount](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L68) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/provider-accounts/:id` | PATCH | Staff | `license.manage` | `UpdateProviderAccountDto` | xem [updateProviderAccount](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L76) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations` | GET | Staff | `license.read` | — | xem [listAllocations](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L94) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations/:id` | GET | Staff | `license.read` | — | xem [getAllocation](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L102) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations/:id/activate` | POST | Staff | `license.manage` | `AdminActivateAllocationDto` | xem [activateAllocation](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L108) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations/:id/reject` | POST | Staff | `license.manage` | `AdminRejectAllocationDto` | xem [rejectAllocation](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L122) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations/:id/request-deactivation` | POST | Staff | `license.manage` | `AdminRequestDeactivationDto` | xem [requestDeactivation](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L132) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/admin/license-allocations/:id/confirm-deactivated` | POST | Staff | `license.manage` | `AdminConfirmDeactivatedDto` | xem [confirmDeactivated](../../apps/api/src/modules/allocations/admin-allocations.controller.ts#L146) | 400 (DTO), 401, 403 | unit module · phase 6 |
| `/entitlements/:id/allocations` | POST | Đã đăng nhập (sở hữu) | — | `RequestAllocationDto` | xem [requestAllocation](../../apps/api/src/modules/allocations/allocations.controller.ts#L23) | 400 (DTO), 401 | unit module · phase 6 |
| `/entitlements/:id/allocations` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listCustomerAllocations](../../apps/api/src/modules/allocations/allocations.controller.ts#L32) | 400 (DTO), 401 | unit module · phase 6 |
| `/entitlements/:id/allocations/:allocationId/request-deactivation` | POST | Đã đăng nhập (sở hữu) | — | `CustomerRequestDeactivationDto` | xem [requestDeactivation](../../apps/api/src/modules/allocations/allocations.controller.ts#L40) | 400 (DTO), 401 | unit module · phase 6 |

#### auth (4 route · unit: 2 file spec · acceptance: mọi phase)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/auth/me` | GET | Đã đăng nhập (sở hữu) | — | — | xem [getMe](../../apps/api/src/modules/auth/auth.controller.ts#L8) | 400 (DTO), 401 | unit module · mọi phase |
| `/rbac/test/customer` | GET | Staff | `profile.read` | — | xem [testCustomer](../../apps/api/src/modules/auth/rbac-test.controller.ts#L10) | 400 (DTO), 401, 403 | unit module · mọi phase |
| `/rbac/test/admin` | GET | Staff | `user.manage` | — | xem [testAdmin](../../apps/api/src/modules/auth/rbac-test.controller.ts#L22) | 400 (DTO), 401, 403 | unit module · mọi phase |
| `/rbac/test/audit` | GET | Staff | `audit.read` | — | xem [testAudit](../../apps/api/src/modules/auth/rbac-test.controller.ts#L34) | 400 (DTO), 401, 403 | unit module · mọi phase |

#### automation (8 route · unit: 1 file spec · acceptance: phase 12)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/automation/jobs` (alias `/admin/automation/jobs`) | GET | Staff | `automation.read` | — | xem [listJobs](../../apps/api/src/modules/automation/admin-automation.controller.ts#L27) | 400 (DTO), 401, 403 | unit module · phase 12 |
| `/v1/admin/automation/jobs/:id` (alias `/admin/automation/jobs/:id`) | GET | Staff | `automation.read` | — | xem [getJob](../../apps/api/src/modules/automation/admin-automation.controller.ts#L33) | 400 (DTO), 401, 403 | unit module · phase 12 |
| `/v1/admin/automation/jobs/:id/retry` (alias `/admin/automation/jobs/:id/retry`) | POST | Staff | `automation.manage` | — | xem [retryJob](../../apps/api/src/modules/automation/admin-automation.controller.ts#L39) | 400 (DTO), 401, 403 | unit module · phase 12 |
| `/v1/admin/automation/jobs/:id/cancel` (alias `/admin/automation/jobs/:id/cancel`) | POST | Staff | `automation.manage` | — | xem [cancelJob](../../apps/api/src/modules/automation/admin-automation.controller.ts#L47) | 400 (DTO), 401, 403 | unit module · phase 12 |
| `/v1/admin/automation/ai-draft` (alias `/admin/automation/ai-draft`) | POST | Staff | `automation.manage` | `CreateAiDraftRequestDto` | xem [createAiDraft](../../apps/api/src/modules/automation/admin-automation.controller.ts#L55) | 400 (DTO), 401, 403 | unit module · phase 12 |
| `/v1/internal/automation/jobs/:id/complete` (alias `/internal/automation/jobs/:id/complete`) | POST | Hệ thống (HMAC n8n) | — | `AutomationCallbackCompleteDto` | xem [completeJob](../../apps/api/src/modules/automation/internal-automation.controller.ts#L24) | 400 (DTO), 401 (HMAC) | unit module · phase 12 |
| `/v1/internal/automation/jobs/:id/fail` (alias `/internal/automation/jobs/:id/fail`) | POST | Hệ thống (HMAC n8n) | — | `AutomationCallbackFailDto` | xem [failJob](../../apps/api/src/modules/automation/internal-automation.controller.ts#L37) | 400 (DTO), 401 (HMAC) | unit module · phase 12 |
| `/v1/internal/automation/content-ai-draft-result` (alias `/internal/automation/content-ai-draft-result`) | POST | Hệ thống (HMAC n8n) | — | `AutomationCallbackAiDraftResultDto` | xem [receiveAiDraftResult](../../apps/api/src/modules/automation/internal-automation.controller.ts#L50) | 400 (DTO), 401 (HMAC) | unit module · phase 12 |

#### cart (5 route · unit: 3 file spec · acceptance: phase 4)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/cart` | GET | Đã đăng nhập (sở hữu) | — | — | xem [getCart](../../apps/api/src/modules/cart/cart.controller.ts#L23) | 400 (DTO), 401 | unit module · phase 4 |
| `/cart/items` | POST | Đã đăng nhập (sở hữu) | — | `AddToCartDto` | xem [addItem](../../apps/api/src/modules/cart/cart.controller.ts#L32) | 400 (DTO), 401 | unit module · phase 4 |
| `/cart/items/:itemId` | PATCH | Đã đăng nhập (sở hữu) | — | `UpdateCartItemDto` | xem [updateItem](../../apps/api/src/modules/cart/cart.controller.ts#L38) | 400 (DTO), 401 | unit module · phase 4 |
| `/cart/items/:itemId` | DELETE | Đã đăng nhập (sở hữu) | — | — | xem [removeItem](../../apps/api/src/modules/cart/cart.controller.ts#L54) | 400 (DTO), 401 | unit module · phase 4 |
| `/cart` | DELETE | Đã đăng nhập (sở hữu) | — | — | xem [clearCart](../../apps/api/src/modules/cart/cart.controller.ts#L64) | 400 (DTO), 401 | unit module · phase 4 |

#### catalog (18 route · unit: 4 file spec · acceptance: phase 4, 17)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/categories` | POST | Staff | `product.write` | `CreateCategoryDto` | xem [createCategory](../../apps/api/src/modules/catalog/admin-categories.controller.ts#L22) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/categories` | GET | Staff | `product.read` | — | xem [listCategories](../../apps/api/src/modules/catalog/admin-categories.controller.ts#L29) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/categories/:id` | GET | Staff | `product.read` | — | xem [getCategory](../../apps/api/src/modules/catalog/admin-categories.controller.ts#L35) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/categories/:id` | PATCH | Staff | `product.write` | `UpdateCategoryDto` | xem [updateCategory](../../apps/api/src/modules/catalog/admin-categories.controller.ts#L41) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products` | POST | Staff | `product.write` | `CreateProductDto` | xem [createProduct](../../apps/api/src/modules/catalog/admin-products.controller.ts#L36) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products` | GET | Staff | `product.read` | — | xem [listProducts](../../apps/api/src/modules/catalog/admin-products.controller.ts#L44) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id` | GET | Staff | `product.read` | — | xem [getProduct](../../apps/api/src/modules/catalog/admin-products.controller.ts#L50) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id` | PATCH | Staff | `product.write` | `UpdateProductDto` | xem [updateProduct](../../apps/api/src/modules/catalog/admin-products.controller.ts#L56) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id` | DELETE | Staff | `product.write` | — | xem [deleteProduct](../../apps/api/src/modules/catalog/admin-products.controller.ts#L68) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id/variants` | POST | Staff | `product.write` | `CreateVariantDto` | xem [createVariant](../../apps/api/src/modules/catalog/admin-products.controller.ts#L79) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id/variants/:variantId` | PATCH | Staff | `product.write` | `UpdateVariantDto` | xem [updateVariant](../../apps/api/src/modules/catalog/admin-products.controller.ts#L90) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/products/:id/variants/:variantId` | DELETE | Staff | `product.write` | — | xem [deleteVariant](../../apps/api/src/modules/catalog/admin-products.controller.ts#L102) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/variants/:variantId/prices` | POST | Staff | `product.write` | `CreatePriceDto` | xem [createPrice](../../apps/api/src/modules/catalog/admin-products.controller.ts#L117) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/admin/prices/:priceId` | PATCH | Staff | `product.write` | `UpdatePriceDto` | xem [updatePrice](../../apps/api/src/modules/catalog/admin-products.controller.ts#L128) | 400 (DTO), 401, 403 | unit module · phase 4, 17 |
| `/products` | GET | Public | — | — | xem [listProducts](../../apps/api/src/modules/catalog/public-catalog.controller.ts#L10) | 400 (DTO) | unit module · phase 4, 17 |
| `/products/:slug` | GET | Public | — | — | xem [getProductBySlug](../../apps/api/src/modules/catalog/public-catalog.controller.ts#L15) | 400 (DTO) | unit module · phase 4, 17 |
| `/categories` | GET | Public | — | — | xem [listCategories](../../apps/api/src/modules/catalog/public-catalog.controller.ts#L28) | 400 (DTO) | unit module · phase 4, 17 |
| `/categories/:slug/products` | GET | Public | — | — | xem [getCategoryProducts](../../apps/api/src/modules/catalog/public-catalog.controller.ts#L33) | 400 (DTO) | unit module · phase 4, 17 |

#### content (11 route · unit: 1 file spec · acceptance: phase 11)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/content/posts` (alias `/admin/content/posts`) | GET | Staff | `content.read` | — | xem [listPosts](../../apps/api/src/modules/content/admin-content.controller.ts#L42) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/posts/:id` (alias `/admin/content/posts/:id`) | GET | Staff | `content.read` | — | xem [getPost](../../apps/api/src/modules/content/admin-content.controller.ts#L50) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/posts` (alias `/admin/content/posts`) | POST | Staff | `content.write` | `CreateContentPostDto` | xem [createPost](../../apps/api/src/modules/content/admin-content.controller.ts#L56) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/posts/:id` (alias `/admin/content/posts/:id`) | PATCH | Staff | `content.write` | `UpdateContentPostDto` | xem [updatePost](../../apps/api/src/modules/content/admin-content.controller.ts#L71) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/posts/:id/transition` (alias `/admin/content/posts/:id/transition`) | POST | Staff | `content.publish` | `ContentPostTransitionDto` | xem [transitionPost](../../apps/api/src/modules/content/admin-content.controller.ts#L82) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/categories` (alias `/admin/content/categories`) | GET | Staff | `content.read` | — | xem [listCategories](../../apps/api/src/modules/content/admin-content.controller.ts#L98) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/categories` (alias `/admin/content/categories`) | POST | Staff | `content.write` | `CreateContentCategoryDto` | xem [createCategory](../../apps/api/src/modules/content/admin-content.controller.ts#L104) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/admin/content/categories/:id` (alias `/admin/content/categories/:id`) | PATCH | Staff | `content.write` | `UpdateContentCategoryDto` | xem [updateCategory](../../apps/api/src/modules/content/admin-content.controller.ts#L112) | 400 (DTO), 401, 403 | unit module · phase 11 |
| `/v1/content/posts` (alias `/content/posts`) | GET | Public | — | — | xem [listPublicPosts](../../apps/api/src/modules/content/content.controller.ts#L20) | 400 (DTO) | unit module · phase 11 |
| `/v1/content/posts/:slug` (alias `/content/posts/:slug`) | GET | Public | — | — | xem [getPublicPostBySlug](../../apps/api/src/modules/content/content.controller.ts#L27) | 400 (DTO) | unit module · phase 11 |
| `/v1/content/categories` (alias `/content/categories`) | GET | Public | — | — | xem [listPublicCategories](../../apps/api/src/modules/content/content.controller.ts#L34) | 400 (DTO) | unit module · phase 11 |

#### downloads (8 route · unit: 5 file spec · acceptance: phase 8)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/products/:productId/versions` | POST | Staff | `product.write` | `CreateProductVersionDto` | xem [createVersion](../../apps/api/src/modules/downloads/admin-versions.controller.ts#L28) | 400 (DTO), 401, 403 | unit module · phase 8 |
| `/admin/products/:productId/versions` | GET | Staff | `product.read` | — | xem [listVersions](../../apps/api/src/modules/downloads/admin-versions.controller.ts#L39) | 400 (DTO), 401, 403 | unit module · phase 8 |
| `/admin/product-versions/:id` | GET | Staff | `product.read` | — | xem [getVersion](../../apps/api/src/modules/downloads/admin-versions.controller.ts#L45) | 400 (DTO), 401, 403 | unit module · phase 8 |
| `/admin/product-versions/:id/files/upload` | POST | Staff | `product.write` | `UploadVersionFileDto + multipart` | xem [uploadFile](../../apps/api/src/modules/downloads/admin-versions.controller.ts#L51) | 400 (DTO), 401, 403 | unit module · phase 8 |
| `/admin/product-versions/:id/publish` | POST | Staff | `product.publish` | — | xem [publishVersion](../../apps/api/src/modules/downloads/admin-versions.controller.ts#L75) | 400 (DTO), 401, 403 | unit module · phase 8 |
| `/v1/downloads/request` | POST | Đã đăng nhập (sở hữu) | — | `RequestDownloadDto` | xem [requestDownload](../../apps/api/src/modules/downloads/downloads.controller.ts#L20) | 400 (DTO), 401 | unit module · phase 8 |
| `/v1/downloads/entitlements/:entitlementId/versions` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listEligibleVersions](../../apps/api/src/modules/downloads/downloads.controller.ts#L34) | 400 (DTO), 401 | unit module · phase 8 |
| `/v1/updates/check` | POST | Plugin trên site khách (license key) | — | `CheckUpdateDto` | xem [checkUpdate](../../apps/api/src/modules/downloads/updates.controller.ts#L9) | 400 (DTO) | unit module · phase 8 |

#### entitlements (5 route · unit: 2 file spec · acceptance: phase 5)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/entitlements` | GET | Staff | `entitlement.read` | — | xem [listAdminEntitlements](../../apps/api/src/modules/entitlements/admin-entitlements.controller.ts#L25) | 400 (DTO), 401, 403 | unit module · phase 5 |
| `/admin/entitlements/:id` | GET | Staff | `entitlement.read` | — | xem [getAdminEntitlement](../../apps/api/src/modules/entitlements/admin-entitlements.controller.ts#L31) | 400 (DTO), 401, 403 | unit module · phase 5 |
| `/admin/entitlements/:id/revoke` | POST | Staff | `entitlement.manage` | `RevokeEntitlementDto` | xem [revokeEntitlement](../../apps/api/src/modules/entitlements/admin-entitlements.controller.ts#L37) | 400 (DTO), 401, 403 | unit module · phase 5 |
| `/entitlements` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listUserEntitlements](../../apps/api/src/modules/entitlements/entitlements.controller.ts#L18) | 400 (DTO), 401 | unit module · phase 5 |
| `/entitlements/:id` | GET | Đã đăng nhập (sở hữu) | — | — | xem [getUserEntitlement](../../apps/api/src/modules/entitlements/entitlements.controller.ts#L26) | 400 (DTO), 401 | unit module · phase 5 |

#### finance (8 route · unit: 1 file spec · acceptance: phase 16)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/finance/ledger` (alias `/admin/finance/ledger`) | GET | Staff | `finance.read` | — | xem [adminListLedger](../../apps/api/src/modules/finance/admin-finance.controller.ts#L32) | 400 (DTO), 401, 403, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/admin/finance/summary` (alias `/admin/finance/summary`) | GET | Staff | `finance.read` | — | xem [adminGetFinancialSummary](../../apps/api/src/modules/finance/admin-finance.controller.ts#L40) | 400 (DTO), 401, 403, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/admin/finance/invoices` (alias `/admin/finance/invoices`) | GET | Staff | `invoice.read` | — | xem [adminListInvoices](../../apps/api/src/modules/finance/admin-finance.controller.ts#L51) | 400 (DTO), 401, 403, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/admin/finance/invoices/:id` (alias `/admin/finance/invoices/:id`) | GET | Staff | `invoice.read` | — | xem [adminGetInvoice](../../apps/api/src/modules/finance/admin-finance.controller.ts#L59) | 400 (DTO), 401, 403, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/admin/finance/invoices` (alias `/admin/finance/invoices`) | POST | Staff | `finance.manage` | `CreateManualInvoiceDto` | xem [adminCreateManualInvoice](../../apps/api/src/modules/finance/admin-finance.controller.ts#L65) | 400 (DTO), 401, 403, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/finance/calculate-tax` (alias `/finance/calculate-tax`) | POST | Đã đăng nhập (sở hữu) | — | `CalculateTaxDto` | xem [calculateTax](../../apps/api/src/modules/finance/finance.controller.ts#L29) | 400 (DTO), 401, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/finance/invoices` (alias `/finance/invoices`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listMyInvoices](../../apps/api/src/modules/finance/finance.controller.ts#L36) | 400 (DTO), 401, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |
| `/v1/finance/invoices/:id` (alias `/finance/invoices/:id`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getMyInvoice](../../apps/api/src/modules/finance/finance.controller.ts#L45) | 400 (DTO), 401, 404 khi FEATURE_FINANCE tắt | unit module · phase 16 |

#### health (7 route · unit: 1 file spec · acceptance: phase 18)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/health` | GET | Vận hành | — | — | xem [getAggregateHealth](../../apps/api/src/modules/health/health.controller.ts#L9) | 400 (DTO) | unit module · phase 18 |
| `/health/db` | GET | Vận hành | — | — | xem [getDbHealth](../../apps/api/src/modules/health/health.controller.ts#L17) | 400 (DTO) | unit module · phase 18 |
| `/health/redis` | GET | Vận hành | — | — | xem [getRedisHealth](../../apps/api/src/modules/health/health.controller.ts#L29) | 400 (DTO) | unit module · phase 18 |
| `/health/storage` | GET | Vận hành | — | — | xem [getStorageHealth](../../apps/api/src/modules/health/health.controller.ts#L43) | 400 (DTO) | unit module · phase 18 |
| `/health/liveness` | GET | Vận hành | — | — | xem [getLiveness](../../apps/api/src/modules/health/health.controller.ts#L57) | 400 (DTO) | unit module · phase 18 |
| `/health/readiness` | GET | Vận hành | — | — | xem [getReadiness](../../apps/api/src/modules/health/health.controller.ts#L63) | 400 (DTO) | unit module · phase 18 |
| `/health/metrics` | GET | Vận hành | — | — | xem [getMetrics](../../apps/api/src/modules/health/health.controller.ts#L73) | 400 (DTO) | unit module · phase 18 |

#### hosting (20 route · unit: 1 file spec · acceptance: phase 14)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/hosting/servers` (alias `/admin/hosting/servers`) | GET | Staff | `hosting.read` | — | xem [listServers](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L35) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/servers/:id` (alias `/admin/hosting/servers/:id`) | GET | Staff | `hosting.read` | — | xem [getServer](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L41) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/servers` (alias `/admin/hosting/servers`) | POST | Staff | `hosting.manage` | `CreateHostingServerDto` | xem [createServer](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L47) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/servers/:id` (alias `/admin/hosting/servers/:id`) | PATCH | Staff | `hosting.manage` | `UpdateHostingServerDto` | xem [updateServer](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L55) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/servers/:id` (alias `/admin/hosting/servers/:id`) | DELETE | Staff | `hosting.manage` | — | xem [deleteServer](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L64) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts` (alias `/admin/hosting/accounts`) | GET | Staff | `hosting.read` | — | xem [listAccounts](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L71) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts/:id` (alias `/admin/hosting/accounts/:id`) | GET | Staff | `hosting.read` | — | xem [getAccount](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L85) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts/:id/suspend` (alias `/admin/hosting/accounts/:id/suspend`) | POST | Staff | `hosting.manage` | `AdminSuspendAccountDto` | xem [suspendAccount](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L91) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts/:id/unsuspend` (alias `/admin/hosting/accounts/:id/unsuspend`) | POST | Staff | `hosting.manage` | — | xem [unsuspendAccount](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L100) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts/:id/terminate` (alias `/admin/hosting/accounts/:id/terminate`) | POST | Staff | `hosting.manage` | — | xem [terminateAccount](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L108) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/admin/hosting/accounts/:id/retry` (alias `/admin/hosting/accounts/:id/retry`) | POST | Staff | `hosting.manage` | — | xem [retryProvision](../../apps/api/src/modules/hosting/admin-hosting.controller.ts#L116) | 400 (DTO), 401, 403, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts` (alias `/hosting/accounts`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listMyAccounts](../../apps/api/src/modules/hosting/hosting.controller.ts#L34) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts` (alias `/hosting/accounts`) | POST | Đã đăng nhập (sở hữu) | — | `CreateHostingAccountDto` | xem [createAccount](../../apps/api/src/modules/hosting/hosting.controller.ts#L40) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id` (alias `/hosting/accounts/:id`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getMyAccount](../../apps/api/src/modules/hosting/hosting.controller.ts#L57) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/sso` (alias `/hosting/accounts/:id/sso`) | POST | Đã đăng nhập (sở hữu) | — | — | xem [generateSsoUrl](../../apps/api/src/modules/hosting/hosting.controller.ts#L66) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/dns` (alias `/hosting/accounts/:id/dns`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listDnsRecords](../../apps/api/src/modules/hosting/hosting.controller.ts#L75) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/dns` (alias `/hosting/accounts/:id/dns`) | POST | Đã đăng nhập (sở hữu) | — | `CreateDnsRecordDto` | xem [createDnsRecord](../../apps/api/src/modules/hosting/hosting.controller.ts#L84) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/dns/:recordId` (alias `/hosting/accounts/:id/dns/:recordId`) | PATCH | Đã đăng nhập (sở hữu) | — | `UpdateDnsRecordDto` | xem [updateDnsRecord](../../apps/api/src/modules/hosting/hosting.controller.ts#L94) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/dns/:recordId` (alias `/hosting/accounts/:id/dns/:recordId`) | DELETE | Đã đăng nhập (sở hữu) | — | — | xem [deleteDnsRecord](../../apps/api/src/modules/hosting/hosting.controller.ts#L105) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |
| `/v1/hosting/accounts/:id/purge-cache` (alias `/hosting/accounts/:id/purge-cache`) | POST | Đã đăng nhập (sở hữu) | — | `PurgeCacheDto` | xem [purgeCache](../../apps/api/src/modules/hosting/hosting.controller.ts#L115) | 400 (DTO), 401, 404 khi FEATURE_HOSTING tắt | unit module · phase 14 |

#### licenses (11 route · unit: 3 file spec · acceptance: phase 7)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/internal-licenses` | GET | Staff | `license.read` | — | xem [adminListLicenses](../../apps/api/src/modules/licenses/admin-licenses.controller.ts#L22) | 400 (DTO), 401, 403 | unit module · phase 7 |
| `/admin/internal-licenses/:id` | GET | Staff | `license.read` | — | xem [adminGetLicense](../../apps/api/src/modules/licenses/admin-licenses.controller.ts#L28) | 400 (DTO), 401, 403 | unit module · phase 7 |
| `/admin/internal-licenses/:id/revoke` | POST | Staff | `license.manage` | `AdminRevokeLicenseDto` | xem [adminRevokeLicense](../../apps/api/src/modules/licenses/admin-licenses.controller.ts#L34) | 400 (DTO), 401, 403 | unit module · phase 7 |
| `/licenses` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listCustomerLicenses](../../apps/api/src/modules/licenses/licenses.controller.ts#L27) | 400 (DTO), 401 | unit module · phase 7 |
| `/licenses/:id` | GET | Đã đăng nhập (sở hữu) | — | — | xem [getCustomerLicense](../../apps/api/src/modules/licenses/licenses.controller.ts#L32) | 400 (DTO), 401 | unit module · phase 7 |
| `/licenses/:id/reveal` | POST | Đã đăng nhập (sở hữu) | — | — | xem [revealLicense](../../apps/api/src/modules/licenses/licenses.controller.ts#L40) | 400 (DTO), 401 | unit module · phase 7 |
| `/licenses/:id/activations` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listCustomerLicenseActivations](../../apps/api/src/modules/licenses/licenses.controller.ts#L49) | 400 (DTO), 401 | unit module · phase 7 |
| `/licenses/:id/deactivate-domain` | POST | Đã đăng nhập (sở hữu) | — | `DeactivateLicenseDomainDto` | xem [deactivateDomain](../../apps/api/src/modules/licenses/licenses.controller.ts#L57) | 400 (DTO), 401 | unit module · phase 7 |
| `/v1/licenses/activate` | POST | Plugin trên site khách (license key) | — | `ActivateLicenseDto` | xem [activateLicense](../../apps/api/src/modules/licenses/public-licenses.controller.ts#L18) | 400 (DTO) | unit module · phase 7 |
| `/v1/licenses/validate` | POST | Plugin trên site khách (license key) | — | `ValidateLicenseDto` | xem [validateLicense](../../apps/api/src/modules/licenses/public-licenses.controller.ts#L26) | 400 (DTO) | unit module · phase 7 |
| `/v1/licenses/deactivate` | POST | Plugin trên site khách (license key) | — | `DeactivateLicenseDto` | xem [deactivateLicense](../../apps/api/src/modules/licenses/public-licenses.controller.ts#L34) | 400 (DTO) | unit module · phase 7 |

#### orders (5 route · unit: 3 file spec · acceptance: phase 4)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/orders` | GET | Staff | `order.read` | — | xem [listOrders](../../apps/api/src/modules/orders/admin-orders.controller.ts#L20) | 400 (DTO), 401, 403 | unit module · phase 4 |
| `/admin/orders/:id` | GET | Staff | `order.read` | — | xem [getOrder](../../apps/api/src/modules/orders/admin-orders.controller.ts#L28) | 400 (DTO), 401, 403 | unit module · phase 4 |
| `/checkout` | POST | Đã đăng nhập (sở hữu) | — | `CheckoutDto` | xem [checkout](../../apps/api/src/modules/orders/checkout.controller.ts#L12) | 400 (DTO), 401 | unit module · phase 4 |
| `/orders` | GET | Đã đăng nhập (sở hữu) | — | — | xem [listOrders](../../apps/api/src/modules/orders/orders.controller.ts#L19) | 400 (DTO), 401 | unit module · phase 4 |
| `/orders/:id` | GET | Đã đăng nhập (sở hữu) | — | — | xem [getOrder](../../apps/api/src/modules/orders/orders.controller.ts#L28) | 400 (DTO), 401 | unit module · phase 4 |

#### payments (7 route · unit: 6 file spec · acceptance: phase 4, 9)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/orders/:orderId/payment-session` (alias `/orders/:orderId/payment-session`) | POST | Đã đăng nhập (sở hữu) | — | `CreatePaymentSessionDto` | xem [createPaymentSession](../../apps/api/src/modules/payments/payment-session.controller.ts#L19) | 400 (DTO), 401 | unit module · phase 4, 9 |
| `/v1/webhooks/payments/:provider` (alias `/webhooks/payments/:provider`) | POST | Cổng thanh toán (xác thực trong handler) | — | — | xem [handleWebhook](../../apps/api/src/modules/payments/payment-webhooks.controller.ts#L22) | 400 (DTO) | unit module · phase 4, 9 |
| `/v1/payments/providers` (alias `/payments/providers`) | GET | Public | — | — | xem [listProviders](../../apps/api/src/modules/payments/payments.controller.ts#L31) | 400 (DTO) | unit module · phase 4, 9 |
| `/v1/payments/:id` (alias `/payments/:id`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getPayment](../../apps/api/src/modules/payments/payments.controller.ts#L36) | 400 (DTO), 401 | unit module · phase 4, 9 |
| `/v1/payments/test-callback` (alias `/payments/test-callback`) | POST | Public | — | `TestPaymentCallbackDto` | xem [handleTestCallback](../../apps/api/src/modules/payments/payments.controller.ts#L45) | 400 (DTO) | unit module · phase 4, 9 |
| `/v1/payments/:id/refresh` (alias `/payments/:id/refresh`) | POST | Đã đăng nhập (sở hữu) | — | — | xem [refreshPayment](../../apps/api/src/modules/payments/payments.controller.ts#L57) | 400 (DTO), 401 | unit module · phase 4, 9 |
| `/v1/payments/:id/reconcile` (alias `/payments/:id/reconcile`) | POST | Staff | `payment.manage` | `ReconcilePaymentDto` | xem [reconcilePayment](../../apps/api/src/modules/payments/payments.controller.ts#L66) | 400 (DTO), 401, 403 | unit module · phase 4, 9 |

#### queue (1 route · unit: 1 file spec · acceptance: worker smoke)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/queue/test-job` | POST | Đã đăng nhập (sở hữu) | — | — | xem [dispatchTestJob](../../apps/api/src/modules/queue/queue.controller.ts#L20) | 400 (DTO), 401 | unit module · worker smoke |

#### subscriptions (10 route · unit: 1 file spec · acceptance: phase 13)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/subscriptions/plans` (alias `/admin/subscriptions/plans`) | GET | Staff | `subscription.read` | — | xem [listPlans](../../apps/api/src/modules/subscriptions/admin-subscriptions.controller.ts#L31) | 400 (DTO), 401, 403, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/admin/subscriptions/plans` (alias `/admin/subscriptions/plans`) | POST | Staff | `subscription.manage` | `AdminCreatePlanDto` | xem [createPlan](../../apps/api/src/modules/subscriptions/admin-subscriptions.controller.ts#L37) | 400 (DTO), 401, 403, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/admin/subscriptions/plans/:id` (alias `/admin/subscriptions/plans/:id`) | PATCH | Staff | `subscription.manage` | `AdminUpdatePlanDto` | xem [updatePlan](../../apps/api/src/modules/subscriptions/admin-subscriptions.controller.ts#L45) | 400 (DTO), 401, 403, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/admin/subscriptions` (alias `/admin/subscriptions`) | GET | Staff | `subscription.read` | — | xem [listSubscriptions](../../apps/api/src/modules/subscriptions/admin-subscriptions.controller.ts#L54) | 400 (DTO), 401, 403, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/admin/subscriptions/:id/cancel` (alias `/admin/subscriptions/:id/cancel`) | POST | Staff | `subscription.manage` | — | xem [cancelSubscription](../../apps/api/src/modules/subscriptions/admin-subscriptions.controller.ts#L62) | 400 (DTO), 401, 403, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/subscriptions/plans` (alias `/subscriptions/plans`) | GET | Public | — | — | xem [listPublicPlans](../../apps/api/src/modules/subscriptions/subscriptions.controller.ts#L31) | 400 (DTO), 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/subscriptions/me` (alias `/subscriptions/me`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getMySubscription](../../apps/api/src/modules/subscriptions/subscriptions.controller.ts#L36) | 400 (DTO), 401, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/subscriptions/checkout-session` (alias `/subscriptions/checkout-session`) | POST | Đã đăng nhập (sở hữu) | — | `CreateSubscriptionSessionDto` | xem [createCheckoutSession](../../apps/api/src/modules/subscriptions/subscriptions.controller.ts#L43) | 400 (DTO), 401, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/subscriptions/customer-portal` (alias `/subscriptions/customer-portal`) | POST | Đã đăng nhập (sở hữu) | — | `CreatePortalSessionDto` | xem [createPortalSession](../../apps/api/src/modules/subscriptions/subscriptions.controller.ts#L54) | 400 (DTO), 401, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |
| `/v1/subscriptions/quota/:entitlementId` (alias `/subscriptions/quota/:entitlementId`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [checkQuota](../../apps/api/src/modules/subscriptions/subscriptions.controller.ts#L65) | 400 (DTO), 401, 404 khi FEATURE_MEMBERSHIP tắt | unit module · phase 13 |

#### tickets (12 route · unit: 2 file spec · acceptance: phase 15)

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/v1/admin/tickets` (alias `/admin/tickets`) | GET | Staff | `ticket.read` | — | xem [adminListTickets](../../apps/api/src/modules/tickets/admin-tickets.controller.ts#L28) | 400 (DTO), 401, 403 | unit module · phase 15 |
| `/v1/admin/tickets/:id` (alias `/admin/tickets/:id`) | GET | Staff | `ticket.read` | — | xem [adminGetTicket](../../apps/api/src/modules/tickets/admin-tickets.controller.ts#L36) | 400 (DTO), 401, 403 | unit module · phase 15 |
| `/v1/admin/tickets/:id` (alias `/admin/tickets/:id`) | PATCH | Staff | `ticket.manage` | `AdminUpdateTicketDto` | xem [adminUpdateTicket](../../apps/api/src/modules/tickets/admin-tickets.controller.ts#L42) | 400 (DTO), 401, 403 | unit module · phase 15 |
| `/v1/admin/tickets/:id/reply` (alias `/admin/tickets/:id/reply`) | POST | Staff | `ticket.manage` | `ReplyTicketDto` | xem [adminReplyTicket](../../apps/api/src/modules/tickets/admin-tickets.controller.ts#L51) | 400 (DTO), 401, 403 | unit module · phase 15 |
| `/v1/notifications` (alias `/notifications`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listMyNotifications](../../apps/api/src/modules/tickets/notifications.controller.ts#L21) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/notifications/unread-count` (alias `/notifications/unread-count`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getUnreadCount](../../apps/api/src/modules/tickets/notifications.controller.ts#L30) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/notifications/:id/read` (alias `/notifications/:id/read`) | PATCH | Đã đăng nhập (sở hữu) | — | — | xem [markAsRead](../../apps/api/src/modules/tickets/notifications.controller.ts#L36) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/notifications/read-all` (alias `/notifications/read-all`) | POST | Đã đăng nhập (sở hữu) | — | — | xem [markAllAsRead](../../apps/api/src/modules/tickets/notifications.controller.ts#L45) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/tickets` (alias `/tickets`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [listMyTickets](../../apps/api/src/modules/tickets/tickets.controller.ts#L25) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/tickets` (alias `/tickets`) | POST | Đã đăng nhập (sở hữu) | — | `CreateTicketDto` | xem [createTicket](../../apps/api/src/modules/tickets/tickets.controller.ts#L34) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/tickets/:id` (alias `/tickets/:id`) | GET | Đã đăng nhập (sở hữu) | — | — | xem [getMyTicket](../../apps/api/src/modules/tickets/tickets.controller.ts#L43) | 400 (DTO), 401 | unit module · phase 15 |
| `/v1/tickets/:id/reply` (alias `/tickets/:id/reply`) | POST | Đã đăng nhập (sở hữu) | — | `ReplyTicketDto` | xem [replyTicket](../../apps/api/src/modules/tickets/tickets.controller.ts#L52) | 400 (DTO), 401 | unit module · phase 15 |

#### users (6 route · unit: 3 file spec · acceptance: phase 4–5 (dev users))

| API | Method | Actor | Permission | Input | Output | Errors | Test |
|---|---|---|---|---|---|---|---|
| `/admin/users` | GET | Staff | `user.read` | — | xem [listUsers](../../apps/api/src/modules/users/admin-users.controller.ts#L26) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |
| `/admin/users/:id` | GET | Staff | `user.read` | — | xem [getUserById](../../apps/api/src/modules/users/admin-users.controller.ts#L37) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |
| `/admin/roles` | GET | Staff | `user.read` | — | xem [listRoles](../../apps/api/src/modules/users/admin-users.controller.ts#L47) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |
| `/admin/permissions` | GET | Staff | `user.read` | — | xem [listPermissions](../../apps/api/src/modules/users/admin-users.controller.ts#L58) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |
| `/admin/users/:id/roles` | POST | Staff | `user.manage` | `AssignRoleDto` | xem [assignRole](../../apps/api/src/modules/users/admin-users.controller.ts#L69) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |
| `/admin/users/:id/roles/:role` | DELETE | Staff | `user.manage` | — | xem [removeRole](../../apps/api/src/modules/users/admin-users.controller.ts#L94) | 400 (DTO), 401, 403 | unit module · phase 4–5 (dev users) |

---

## 5. Cách trích xuất

Bảng §4 được sinh bằng cách quét mọi file `apps/api/src/**/*controller*.ts` (trừ `*.spec.ts`). Với mỗi controller, script đọc:
- `@Controller(...)`: prefix và alias;
- `@UseGuards(...)` và `@RequireFeature(...)` ở cấp class;
- với mỗi handler: `@Get/@Post/@Put/@Patch/@Delete`, `@RequirePermissions` (handler ghi đè class), `@UseGuards`, kiểu tham số `@Body()`, `@UploadedFile(s)`.

Kết quả: 202 route, khớp 31/31 route Services đã kiểm bằng tay. Khi controller thay đổi, cần sinh lại bảng.
