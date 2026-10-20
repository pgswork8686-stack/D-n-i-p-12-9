# Feature completion matrix

Đếm và đối chiếu từ code trên nhánh PR #48 (`867736e`; `main` `fc9508c` và PR #47 `20570a4` đều là tổ tiên của commit này), ngày 2026-10-20.
"Route API" = số handler HTTP trong các controller dưới `apps/api/src/modules/`. "Kiểm chứng" chỉ ghi những gì **đã chạy**:

- **AC n** = acceptance phase n (API + PostgreSQL + Redis thật, chạy trong CI `verify`). Một số gate chỉ kiểm tĩnh hoặc gán cứng — ghi rõ ở dòng tương ứng.
- **E2E** = Playwright trên trình duyệt thật (CI `verify` bước ST01, hoặc job `e2e-fullstack`).
- **Unit** = số file spec.

Mọi PASS dưới đây là trong môi trường **test/CI**: token đăng nhập dev, cổng thanh toán thử nghiệm, MinIO, mock SePay, sink email.
Phần phụ thuộc tài khoản/hạ tầng ngoài chưa có là **BLOCKED** (xem [open-blockers.md](open-blockers.md)).

Cột Figma để trống có chủ đích: chưa đọc được Figma mới nhất ([figma-code-gap.md](figma-code-gap.md)).

## Thương mại (phạm vi phát hành MVP)

| Module | Route API | UI (route) | Kiểm chứng | Trạng thái (test) | Ghi chú |
|---|---|---|---|---|---|
| auth | 4 (`GET /auth/me` + 3 route chẩn đoán `rbac/test/{customer,admin,audit}`) | web `/login` `/register` `/forgot-password` `/reset-password`; portal `/login` `/account/security`; admin `/login` | Unit 2; E2E đăng nhập bằng token dev; Portal E2E "chưa đăng nhập → trang đăng nhập" | PASS (luồng token dev) | Supabase thật: **BLOCKED** (B3). Frontend: công cụ token dev chỉ có khi `NODE_ENV !== "production"` (Next inline lúc build). API: `DevMockAuthProvider` trả null khi `NODE_ENV=production` (unit `packages/auth/src/dev-provider.spec.ts`), và khi có `SUPABASE_URL` + service role key thì luôn dùng Supabase (`auth.module.ts`). Route `rbac/test/*` đăng ký cả ở production — backlog P2-4 |
| users / RBAC | 6 | admin `/admin/users` (AD14) | Unit 3; AC 10 gate 4 (khách gọi `GET /admin/users` → 403); E2E AD14 (danh sách, lọc vai trò, ô gán vai trò bị khoá) | PASS (danh sách + khách 403) | Gán/gỡ vai trò (`POST`/`DELETE …/roles`): chỉ unit → **NOT VERIFIED**. **SEC-1 (P0)** trên `main`: khách đọc được `/admin/orders`, `/admin/tickets` — sửa ở PR #52. Xem [security-and-rbac-matrix.md](security-and-rbac-matrix.md) |
| catalog | 18 | web `/` `/products` `/products/[slug]`; admin `/admin/products` `/new` `/[id]` `/admin/categories` | Unit 4; AC 4; E2E ST01 (trang chủ, lọc, thẻ sản phẩm, axe); E2E AD03–AD07 (tạo sản phẩm → gói → giá → đăng bán) | PASS | |
| cart / orders | 10 | web `/cart` `/checkout` `/orders/[id]`; portal `/orders` `/orders/[id]`; admin `/admin/orders` `/[id]` | Unit 6; AC 4, AC 5 (snapshot giá/chính sách); E2E purchase-flow; PT08 | PASS (luồng) | `main`: `/admin/orders` mở cho khách (SEC-1) — **FAIL bảo mật**, sửa ở PR #52 |
| payments | 11 | portal `/payment/result`; admin `/admin/payments/reconciliation` (AD10) | Unit 7; AC 4 (gate 9 sự kiện trùng, gate 20 webhook thành công đồng thời → đúng 1 ORDER_PAID); E2E purchase-flow (cổng thử: callback ký đúng; ký sai bị từ chối; gửi lại trả <500); E2E AD10 (ngoại lệ SePay: thiếu/thừa tiền, sai mã, không mã → ca đối soát; gửi lại không nhân đôi; sai khoá 401; quyền: khách 403, ẩn danh 401) | PASS (cổng thử + mock SePay) | SePay **đúng số tiền → PAID**: chỉ unit (`sepay-payment.provider.spec.ts`). Vai trò staff chỉ đọc chưa được E2E. SePay thật: **BLOCKED** (B5). Stripe chỉ có client mock |
| entitlements | 5 | portal `/entitlements` `/[id]`; admin `/admin/entitlements` (AD11) | Unit 2; AC 5; E2E purchase-flow; AD11 (thu hồi bắt buộc lý do) | PASS | Trang `/entitlements/[id]` (PT04) chưa có E2E |
| licenses (nội bộ) | 11 | portal `/licenses` `/[id]`; admin `/admin/internal-licenses` (AD12) | Unit 3; AC 7; E2E PT05 (key luôn che, chỉ hiện khi bấm), AD12 | PASS | |
| allocations (quản lý hộ) | 14 | portal `/allocations`; admin `/admin/license-allocations` (AD13) | Unit 2; AC 6, AC 9 (provider); E2E AD13 (hiển thị công suất, hàng chờ) | PASS (luồng thủ công) | Điều kiện thương mại/pháp lý Elementor: việc của PGS, chưa kiểm |
| downloads / versions | 8 | portal `/downloads`; admin `/admin/products/[id]/versions` (AD05) | Unit 5; AC 8 (SemVer, bất biến sau phát hành, grant); E2E AD05 (bản nháp → tải `.zip` lên object storage → phát hành) | PASS (MinIO) | R2: **BLOCKED** (B4) |
| tickets + notifications | 12 (gồm 4 route notifications) | portal `/tickets` `/[id]` `/notifications`; admin `/admin/tickets` `/[id]` (AD15–16) | Unit 3 (+2 notifications); AC 15; E2E PT10–11 (khách thấy phản hồi, không thấy ghi chú nội bộ; không mở được ticket người khác), AD15–16; E2E PT12 `/notifications` (tiêu đề, không tràn ngang, 3 viewport); Services acceptance gọi `GET /v1/notifications` (admin thấy, khách không) | PASS | AC 15 gate 70–74 gán cứng `true` (không phải bằng chứng). Đánh dấu đã đọc / đọc tất cả: **NOT VERIFIED** |
| content / CMS / chính sách | 12 | web `/blog` `/blog/[slug]` `/blog/category/[slug]` `/chinh-sach` `/chinh-sach/[slug]`; admin `/content` `/content/[id]` `/content/new` `/content/categories` (alias `/admin/content`) | Unit 1; AC 11; E2E ST13 (chưa xuất bản = 404, nháp không lộ, script bị loại) | PASS (kỹ thuật) | 6 chính sách: **BLOCKED** (B9) — chưa được PGS phê duyệt nội dung |
| automation / n8n | 8 | admin `/automation` `/automation/[id]` (alias `/admin/automation`) | Unit 2; AC 12 (HMAC, chống replay 409); n8n thật chạy local (xem [end-to-end-flow-map.md](end-to-end-flow-map.md) F3) | PASS (AC); n8n runtime: local | Không chạy trong CI. Replay guard trên `main` **FAIL** khi Redis có mật khẩu — sửa ở PR #50. n8n staging: **BLOCKED** (B7) |

## Services Foundation (agency)

| Module | Route API | UI (route) | Kiểm chứng | Trạng thái (test) | Ghi chú |
|---|---|---|---|---|---|
| services | 32 | web `/services` `/services/[slug]`; portal `/services` `/services/inquiries/[id]` `/services/projects/[id]`; admin `/services` `/service-inquiries` `/[id]` `/service-projects` `/[id]` | Unit 9; Services acceptance 93/93 (validation, idempotency, rate limit, magic bytes, IDOR, RBAC, transition, audit); E2E ST01 form mode (consent version, outbox không chứa dữ liệu cá nhân, worker → thông báo đúng nhân sự) | PASS (test) | Flag `services` TẮT ở production. F-13 quota upload: PR #49 (98 gate, chưa merge). API từ chối khởi động ở production nếu bật mà thiếu `SERVICE_CONSENT_VERSION`, `PRIVACY_POLICY_URL`, `SERVICE_INQUIRY_IP_SALT`. Chính sách quyền riêng tư đã duyệt: **BLOCKED** (B9) |

## Module ngoài phạm vi phát hành (feature flag TẮT ở production)

| Module | Route API | UI | Kiểm chứng | Trạng thái |
|---|---|---|---|---|
| hosting | 20 | portal `/hosting` | AC 14 | NOT APPLICABLE |
| finance (thuế, hoá đơn, sổ cái) | 8 | portal `/invoices` `/[id]` | AC 16 | NOT APPLICABLE |
| affiliates | 11 | portal `/affiliate` | AC 13 | NOT APPLICABLE |
| subscriptions (membership) | 10 | portal `/subscription` | AC 13 | NOT APPLICABLE |

Khi flag tắt, API trả 404 và thanh điều hướng Portal ẩn mục tương ứng (`GET /v1/features`, chỉ `portal-shell.tsx` đọc). Mở thẳng URL trang
vẫn hiển thị khung trang và lỗi từ API — P2-2.

## Hạ tầng và vận hành

| Hạng mục | Kiểm chứng | Trạng thái |
|---|---|---|
| Health/readiness, lọc dữ liệu nhạy cảm trong log | AC 18 (gọi trong tiến trình với DB/Redis thật) | PASS |
| OWASP, backup, runbook trong AC 18 | Nhiều gate chỉ kiểm file tồn tại / chuỗi có mặt; gate 57, 65 gán cứng; gate 66 chỉ tìm `memory:` (production-compose chỉ giới hạn bộ nhớ api và worker) | Kiểm tĩnh — **không** phải bằng chứng runtime |
| Backup mã hoá + xác thực + restore drill | `backup-selftest.sh` trong CI (dữ liệu tổng hợp, container dùng một lần) | PASS (tổng hợp); backup offsite thật **BLOCKED** (B2) |
| Giới hạn request Caddy (413) | `verify-caddy-limits.sh` trong CI | PASS |
| Monitoring/cảnh báo | `infra/monitoring/selftest.sh` trong CI | PASS (giả lập); Telegram thật **BLOCKED** (B8) |
| Cách ly cấu hình staging | `staging-preflight-ci.sh` trong CI | PASS (cấu hình); VPS staging **BLOCKED** (B2) |
| `production-preflight.sh`, `staging-smoke.sh` | CI chỉ kiểm cú pháp (`bash -n`) | NOT VERIFIED |
| Design tokens/UI dùng chung | AC 17 (kiểm tĩnh) | PASS (tĩnh); đối chiếu Figma mới **BLOCKED** (B1) |
