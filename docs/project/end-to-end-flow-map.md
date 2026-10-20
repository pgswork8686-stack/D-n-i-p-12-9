# End-to-end flow map

Mỗi luồng ghi: các bước, API, thực thể, vai trò, và bằng chứng. "Test" = môi trường CI/local cách ly (token dev, cổng thanh toán thử,
MinIO, mock SePay/email). "Staging" = hệ thống thật (Supabase, SePay, R2, Resend, n8n) — hiện **BLOCKED** cho mọi luồng.

## F1. Mua sản phẩm số (cổng thử nghiệm)

```
Storefront /products/[slug] → POST /cart/items → /checkout → POST /checkout (idempotencyKey)
→ POST /orders/:id/payment-session → webhook/callback có chữ ký → Order PAID (transaction) → OutboxEvent ORDER_PAID
→ worker: Entitlement (+ InternalLicense nếu INTERNAL_LICENSE) → Portal /orders, /entitlements, /licenses → Admin /admin/orders/:id
```

| Thuộc tính | Nội dung |
|---|---|
| Vai trò | customer (mua), staff/admin (xem) |
| Thực thể | Cart, CartItem, Order, OrderItem (snapshot giá/chính sách), Payment, PaymentEvent, OutboxEvent, Entitlement, InternalLicense |
| Bất biến | Trình duyệt không thể tự xác nhận PAID; chữ ký sai bị từ chối; sự kiện thanh toán trùng không tạo trùng (AC 4 gate 9; gate 20: webhook thành công đồng thời → đúng 1 sự kiện ORDER_PAID); license chỉ cấp khi PAID |
| Test | **PASS** — E2E `purchase-flow` (CI `e2e-fullstack`, 4/4; gửi lại callback chỉ được kiểm là không lỗi 5xx); AC 4, AC 5, AC 7 |
| Staging | **BLOCKED** — Supabase + SePay thật |

## F2. Thanh toán VietQR SePay và đối soát (AD10)

```
Checkout VietQR → Payment PENDING → webhook SePay (Apikey) → xác thực → idempotency → transaction → Order PAID → Outbox
Ngoại lệ: thiếu/thừa tiền, sai mã, không mã → PaymentReconciliationCase OPEN (không đổi trạng thái đơn)
→ nhân sự có payment.manage xem, truy vấn lại SePay (chỉ đọc), ghi chú bắt buộc, không xử lý hai lần
```

| Thuộc tính | Nội dung |
|---|---|
| Vai trò | hệ thống (webhook), staff có `payment.manage` (xử lý), staff chỉ đọc (xem) |
| Thực thể | Payment, PaymentEvent, PaymentReconciliationCase (2 migration trong PR #48, số tiền bigint) |
| Test | **PASS (ngoại lệ)** — E2E AD10 (CI `e2e-fullstack`, mock SePay API cổng 4568): thiếu/thừa tiền, sai mã, không mã, sai khoá, gửi lại, quyền (khách 403, ẩn danh 401, admin xử lý). Luồng **đúng số tiền → PAID** qua SePay: chỉ unit. Vai trò staff chỉ đọc: chưa E2E |
| Staging | **BLOCKED** — tài khoản SePay; phân biệt "đã ghi nhận xử lý" với "đã hoàn tiền ngân hàng" cần quy trình PGS duyệt |

## F3. Email sau thanh toán qua n8n

```
Outbox ORDER_PAID → worker tạo AutomationJob ORDER_PAID_EMAIL / LICENSE_PROVISIONED_EMAIL (providerIdempotencyKey, maskedKey)
→ dispatch HTTP có HMAC → n8n Verify (HMAC, timestamp, replay guard Redis) → provider email → callback có HMAC → job SUCCEEDED
```

| Thuộc tính | Nội dung |
|---|---|
| Thực thể | AutomationJob, AutomationDelivery |
| Bất biến | Không lộ key thật; mỗi email đúng 1 lần theo idempotency key; chữ ký sai/sai service → 0 lần gọi provider; replay bị từ chối |
| Test | **PASS (local)** — PR #48 `c4ca29e`, 2026-10-19 ~17:04 UTC: n8n 2.40.0 thật, Redis riêng trên network nội bộ, API + worker trên PostgreSQL/Redis test cách ly, sink email giả; `automation/n8n/scripts/runtime-smoke.mjs` 16/16, `automation/n8n/scripts/live-flow-check.mjs` 15/15 (`N8N_LIVE_PRODUCT_SLUG=nexus-plugin-pro`). Không chạy trong CI; cần chạy lại sau khi #50 và #48 vào `main` |
| Lỗ hổng đã sửa | Replay lọt qua khi Redis có mật khẩu → PR #50 |
| Staging | **BLOCKED** — n8n instance, Redis replay, Resend |
| Chưa kiểm | Retry khi provider không phản hồi, worker khi n8n restart, khử trùng ở phía Resend thật |

## F4. Tải bản phát hành

```
Admin AD05: tạo ProductVersion DRAFT (SemVer) → tải .zip lên storage private → phát hành (bất biến sau đó)
→ khách có Entitlement → Portal /downloads → DownloadGrant → signed URL ngắn hạn → DownloadEvent
```

| Test | **PASS** — AC 8; E2E AD05 (MinIO) |
|---|---|
| Staging | **BLOCKED** — R2 private |

## F5. License quản lý hộ (EXTERNAL_MANAGED)

```
Order PAID → Entitlement EXTERNAL_MANAGED → hàng chờ phân bổ → nhân sự xử lý thủ công (AD13) → LicenseAllocation → Portal /allocations
```

| Test | **PASS** — AC 6, AC 9; E2E AD13 (hiển thị) |
|---|---|
| Staging | **BLOCKED** |
| Chưa kiểm | Điều kiện thương mại/pháp lý với nhà cung cấp (Elementor) — việc của PGS |

## F6. Hỗ trợ khách hàng

```
Portal /tickets → tạo ticket → Admin trả lời công khai / ghi chú nội bộ → khách chỉ thấy phản hồi công khai
```

| Test | **PASS** — AC 15 (gate 70–74 gán cứng, không tính); E2E PT10–11, AD15–16; khách không mở được ticket của người khác |
|---|---|
| Staging | **BLOCKED** |

## F7. Services Foundation (agency)

```
Khách xem /services → form yêu cầu (consent version thật, marketing consent độc lập, honeypot, rate limit, idempotency, upload kiểm magic bytes)
→ ServiceInquiry → Outbox SERVICE_INQUIRY_CREATED → worker → Notification cho nhân sự có inquiry.read (+ email qua n8n)
→ review → qualify → convert (idempotent) → ServiceProject → thành viên, milestone, tài liệu, tin nhắn → bàn giao
```

| Thuộc tính | Nội dung |
|---|---|
| Flag | `services` TẮT ở production cho đến khi nghiệm thu |
| Test | **PASS** — Services acceptance 93/93; E2E ST01 form mode (lưu consent, outbox không chứa dữ liệu cá nhân, thông báo đúng nhân sự) |
| Đang chờ | F-13 quota upload theo tài khoản (PR #49) |
| Staging | **BLOCKED** — chính sách quyền riêng tư đã duyệt + HTTPS URL; email nhân sự qua n8n |

## F8. CMS, blog và chính sách

```
Admin /content: bản nháp → review → xuất bản/lưu trữ → web /blog, /chinh-sach/[slug] (chỉ PAGE đã xuất bản; nháp = 404, không vào sitemap/footer)
CMS AI: AutomationJob CMS_AI_DRAFT → n8n → callback → bài viết AI_DRAFT (không tự xuất bản)
```

| Test | **PASS** — AC 11, AC 12; E2E ST13; runtime-smoke CMS_AI_DRAFT (local, `c4ca29e`) |
|---|---|
| Staging | **BLOCKED** |
| Blocker | 6 chính sách chưa được PGS phê duyệt — không tự xuất bản |

## F9. Vận hành

| Luồng | Test | Staging |
|---|---|---|
| Backup mã hoá → kiểm tra toàn vẹn → restore drill | PASS (CI, dữ liệu tổng hợp) | BLOCKED |
| Healthcheck → cảnh báo FIRING/RECOVERED | PASS (CI, giả lập) | BLOCKED (Telegram) |
| Deploy → migrate → smoke → rollback | NOT VERIFIED — có script (`production-preflight.sh`, `staging-smoke.sh`), CI chỉ kiểm cú pháp | BLOCKED |
