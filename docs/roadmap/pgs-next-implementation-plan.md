# PGS — Kế hoạch triển khai tiếp theo

| Mục | Giá trị |
|---|---|
| Ngày lập | 2026-10-16 |
| Nền | `main` `1237c8c` + PR #27 `eec160a` (chưa merge) |
| Nguyên tắc | Mỗi sprint kết thúc bằng PR riêng, CI xanh trên commit cuối, có bằng chứng tái kiểm được. Không có lịch hoàn thành vì chưa biết nguồn lực, môi trường và quy mô nhân sự. |

Thang độ phức tạp: **S** (≤ vài ngày-người) · **M** · **L** · **XL** (nhiều PR, cần chia nhỏ). Đây là ước lượng tương đối, không phải cam kết thời gian.

Trạng thái dùng thống nhất: `IMPLEMENTED` → `UNIT_TESTED` → `INTEGRATION_TESTED` → `E2E_TESTED` → `CODE_MERGE_READY` → `MERGED` → `STAGING_VERIFIED` → `PRODUCTION_VERIFIED`. Các trạng thái này không thay thế cho nhau.

---

## Sprint 0 — Review & ổn định PR #27

| Mục | Nội dung |
|---|---|
| Scope | Chốt review PR #27; quyết định F-12 (consent); xác nhận topology proxy (F-07); chuẩn bị bật `FEATURE_SERVICES` trên staging |
| Dependencies | review này; quyền merge của chủ dự án |
| Database | không (migration Services đã có trong PR) |
| Backend APIs | không thêm. Nếu F-07 cần đổi `trust proxy`, mở PR hạ tầng riêng (ảnh hưởng mọi module) |
| Frontend routes | không thêm |
| Test | CI xanh trên HEAD cuối cùng của PR #27; acceptance Services trên staging (API thật, Supabase thật, R2 thật) |
| Acceptance criteria | PR #27 `MERGED`; staging: tắt flag → 404, bật flag → 6 dịch vụ `DRAFT` chưa công khai; publish 1 dịch vụ → form gửi được, IDOR bị chặn; `STAGING_VERIFIED` |
| Risk | F-07 (rate limit theo IP sai topology); consent chưa quyết |
| Complexity | S |
| PR boundaries | PR #27 (đã có); PR hạ tầng `trust proxy` + giới hạn body ở reverse proxy (F-08) nếu cần |

## Sprint 1 — Tích hợp frontend

| Mục | Nội dung |
|---|---|
| Scope | Batch 1–3 trong [kế hoạch tích hợp](../frontend/pgs-integration-plan.md): B0 + B1 lên `main`; B2 rebase (3 xung đột) và nối form ST01 vào `POST /v1/service-inquiries`; Services dùng component B1 (thay `window.confirm` bằng `Dialog`, `DataTable`, `States`); dọn F-11 |
| Dependencies | Sprint 0; quyết định consent; quyền tạo PR cho B0–B2 |
| Database | không, trừ khi consent cần lưu: `service_inquiries.consent_version`, `consent_at` (additive, PR backend riêng) |
| Backend APIs | không thêm (form ST01 dùng API có sẵn) |
| Frontend routes | `/` (ST01, bỏ `DEMO_ONLY`), `/403`, `not-found`, `error` (SY01–03), restyle SV01–SV08 |
| Test | CI; Playwright 1440/768/390 cho ST01, SY01–03, SV01–SV08; E2E gửi form ST01 thật |
| Acceptance criteria | Form ST01 gửi thật (201, xử lý 400/409/429/503); không còn form mô phỏng trên production; 0 tràn ngang, 0 lỗi console; `E2E_TESTED` cho các màn trên |
| Risk | Đổi bảng màu thương hiệu (brand `#4F46E5` → `#3155D9`) ảnh hưởng mọi trang storefront; xung đột header |
| Complexity | L |
| PR boundaries | (1) B0+B1; (2) B2 rebase + ST01 dùng API thật; (3) `feat/frontend-services-b1-adoption`; (4) consent backend nếu cần |

## Sprint 2 — Unified Quotation: backend

| Mục | Nội dung |
|---|---|
| Scope | PR Q1–Q4 của [RFC](../architecture/unified-quotation-rfc.md): schema, domain engine (state machine, pricing), API staff + khách + quote request công khai, worker sinh PDF |
| Dependencies | Sprint 0 (PR #27 merged); quyết định D-1 (thuế/làm tròn), D-2 (ngưỡng duyệt), D-6 (thông tin PDF), D-7 (tiền tệ), D-8 (ẩn danh) |
| Database | 14 bảng mới + enum + partial unique index + CHECK + trigger bất biến; `ServicePricingMode` thêm `BOTH` (migration riêng) |
| Backend APIs | §3 của [API matrix](../architecture/pgs-api-permissions-matrix.md) trừ `checkout` và hợp đồng |
| Frontend routes | không (Sprint 3) |
| Test | unit ma trận trạng thái + tính tiền; integration ràng buộc DB (PostgreSQL thật); HTTP acceptance (IDOR, RBAC, hash sai → 409, quá hạn, idempotent); worker PDF idempotent; regression phase 4→18 + Services |
| Acceptance criteria | Mọi chuyển trạng thái sai bị từ chối ở backend; phiên bản đã gửi không sửa được (cả service lẫn trigger); PDF chỉ tải qua signed URL sau kiểm tra quyền; `INTEGRATION_TESTED` |
| Risk | Thiếu quyết định D-1 chặn tính thuế; worker cần handler cho event mới (event lạ hiện làm hỏng outbox) |
| Complexity | XL (chia 4 PR) |
| PR boundaries | Q1 schema+engine · Q2 API staff · Q3 API khách + công khai · Q4 worker PDF |

## Sprint 3 — Unified Quotation: frontend

| Mục | Nội dung |
|---|---|
| Scope | Storefront nút "Yêu cầu báo giá" + `/quote-request`; Portal `/quotes`, `/quotes/[id]`; Admin `/admin/quote-requests`, `/admin/quotations` (theo §24 RFC) |
| Dependencies | Sprint 1 (component B1), Sprint 2 |
| Database | không |
| Backend APIs | dùng API Sprint 2 |
| Frontend routes | như trên |
| Test | unit component; Playwright 1440/768/390; E2E ví dụ E1, E3 (RFC §23) |
| Acceptance criteria | Chấp thuận gửi kèm `snapshotHash`; giao diện xử lý 409 (phiên bản đã đổi); admin chỉ hiện nút hợp lệ nhưng backend vẫn quyết định; `E2E_TESTED` |
| Risk | Bảng sửa hạng mục (`QuoteLineEditor`) phức tạp ở mobile |
| Complexity | L |
| PR boundaries | (1) Storefront + Portal · (2) Admin |

## Sprint 4 — Hợp đồng & thanh toán dịch vụ

| Mục | Nội dung |
|---|---|
| Scope | PR Q5–Q6: đơn hàng số từ báo giá (`quotation_orders`), hợp đồng, milestone hợp đồng, đợt thanh toán, đơn theo đợt, handler `ORDER_PAID` → đợt `PAID` |
| Dependencies | Sprint 2; **chủ dự án duyệt điểm chạm Commerce** (đường tạo đơn mới); quyết định D-3 (entitlement cho `MANUAL_SERVICE`), D-5 (hợp đồng) |
| Database | `service_contracts`, `contract_milestones`, `billing_schedules`, `project_billing_links`, `quotation_orders` (nếu chưa tạo ở Q1); sản phẩm/biến thể hệ thống cho đợt thanh toán dịch vụ (seed) |
| Backend APIs | `POST /v1/me/quotations/:id/checkout`, `POST /v1/admin/quotations/:id/contract`, `PATCH /v1/admin/contracts/:id`, `POST …/billing-schedules/:sid/issue-order` |
| Frontend routes | Portal `/contracts/[id]`; Admin `/admin/contracts/[id]` |
| Test | regression phase 4, 5, 9 (commerce, entitlement, payment) bắt buộc; webhook SePay so số tiền với đơn từ báo giá; tổng các đợt luôn bằng tổng báo giá |
| Acceptance criteria | `PAID` chỉ qua webhook đã xác thực; entitlement đúng quyền ghi trong snapshot báo giá; đợt `PAID` đúng một lần; không đổi hành vi đơn thường |
| Risk | Cao — chạm lõi Commerce/Entitlement; cần duyệt trước |
| Complexity | XL |
| PR boundaries | Q5 đơn hàng số · Q6 hợp đồng + đợt thanh toán |

## Sprint 5 — Nền tảng AI/Chatbot

| Mục | Nội dung |
|---|---|
| Scope | Quyết định số phận PR #23 (rebase hay chia nhỏ); nếu giữ: tách `packages/ai-core`, Tenant, multiSchema thành PR nhỏ, áp `@@schema("public")` cho Services/Quotation |
| Dependencies | Sprint 0; PR #23 phải được rebase lên `main` hiện tại (đang `dirty`, CI 12/12 đỏ) |
| Database | Tenant, TenantMember, schema `analytics` (theo PR #23); `tenant_id` FK cho `quote_requests`/`quotations` (cột đã chừa sẵn) |
| Backend APIs | theo PR #23 sau khi rebase; mở rộng `canAccessProject`/`canAccessQuotation` cho thành viên tenant |
| Frontend routes | chưa xác định — cần thiết kế |
| Test | CI xanh cho PR #23 (hiện đỏ); acceptance phase 19 + regression toàn bộ; test chuyển quyền sở hữu không mất dữ liệu |
| Acceptance criteria | Không mất quyền sở hữu dữ liệu hiện có (user-owned); Services/Quotation vẫn qua acceptance sau multiSchema |
| Risk | Cao — multiSchema chạm mọi model; xung đột với nhiều PR |
| Complexity | XL |
| PR boundaries | (1) rebase + sửa CI PR #23 · (2) multiSchema annotations riêng · (3) ai-core · (4) tenant access cho Services |

## Sprint 6 — Kênh Messenger / Website chat

| Mục | Nội dung |
|---|---|
| Scope | Kết nối kênh (Facebook Messenger, widget website, Zalo OA) cho dịch vụ chatbot của khách — chỉ qua API chính thức của nền tảng |
| Dependencies | Sprint 5; tài khoản developer/app review của nền tảng (bên ngoài) |
| Database | kênh, cấu hình kết nối (secret mã hóa như `HOSTING_ENCRYPTION_KEY`), hội thoại — cần RFC riêng |
| Backend APIs | webhook kênh (xác thực chữ ký), quản lý kết nối |
| Frontend routes | Portal quản lý chatbot; widget nhúng |
| Test | xác thực chữ ký webhook; cô lập dữ liệu giữa khách; rate limit |
| Acceptance criteria | cần RFC riêng trước khi lập |
| Risk | phụ thuộc chính sách nền tảng bên ngoài; dữ liệu cá nhân |
| Complexity | XL |
| PR boundaries | RFC trước, sau đó từng kênh một PR |

## Sprint 7 — Khung khởi tạo Custom Web App

| Mục | Nội dung |
|---|---|
| Scope | Template/starter nội bộ cho dự án Custom Web App (auth, RBAC, audit, CI) để giao dự án nhanh hơn — **không** nằm trong nền tảng Marketplace |
| Dependencies | quyết định sản phẩm (repo riêng hay monorepo) |
| Database | không ảnh hưởng DB nền tảng |
| Backend APIs | không |
| Frontend routes | không |
| Test | CI của template |
| Acceptance criteria | cần quyết định phạm vi trước |
| Risk | dễ trôi phạm vi |
| Complexity | L |
| PR boundaries | repo/nhánh riêng |

---

## Không làm trong các sprint trên

- Không xây Chatbot SaaS, CRM hay ERP đầy đủ khi Sprint 0–4 chưa được nghiệm thu.
- Không xóa module Hosting hay migration cũ. Đề xuất vô hiệu hóa kinh doanh Hosting ở `docs/services-foundation.md`.
- Không đổi Auth Provider, database hay tách microservice.
