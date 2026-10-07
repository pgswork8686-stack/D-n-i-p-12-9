# Go-Live Checklist (Staging & Production Pilot)

Bảng kiểm chuẩn toàn diện trước khi mở lưu lượng hoặc chuyển giao hệ thống sang trạng thái **PRODUCTION PILOT READY**.

---

## 1. Domain & DNS Configuration
- [ ] Subdomain Staging được trỏ đúng địa chỉ IP máy chủ (A record):
  - `staging.domain.com` -> IP
  - `app-staging.domain.com` -> IP
  - `admin-staging.domain.com` -> IP
  - `api-staging.domain.com` -> IP
- [ ] Cloudflare Proxy Mode: Khuyến nghị "DNS Only" (Grey cloud) trong lần đầu cấp chứng chỉ SSL tự động của Caddy, hoặc thiết lập Cloudflare SSL mode là "Full (Strict)".

## 2. Network & Firewall
- [ ] Cổng công khai duy nhất mở trên VPS: `80/tcp`, `443/tcp` (và `22/tcp` cho SSH).
- [ ] Cổng `5432` (PostgreSQL) và `6379` (Redis) bị chặn hoàn toàn khỏi internet công cộng.

## 3. Storage (Cloudflare R2)
- [ ] R2 Bucket được tạo ở chế độ **Private** (không bật public access R2.dev).
- [ ] S3 API credentials (Access Key & Secret Key) có quyền `Admin-Read-Write` trên bucket.
- [ ] Xác minh API có thể upload file và tạo signed download URL thành công.

## 4. Authentication (Supabase Auth)
- [ ] Đã tạo project Supabase Staging độc lập (không chung project production).
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` được điền đầy đủ vào file cấu hình.
- [ ] Thử nghiệm đăng ký tài khoản khách hàng thực tế qua giao diện web.
- [ ] Xác nhận cờ `NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS=false` và `SEED_DEV_USERS=false`.

## 5. Payments (SePay VietQR)
- [ ] Cấu hình tài khoản ngân hàng nhận tiền tại SePay dashboard: Khớp `SEPAY_BANK_CODE` và `SEPAY_BANK_ACCOUNT`.
- [ ] Cấu hình tiền tố mã thanh toán tại SePay: `SEPAY_PAYMENT_CODE_PREFIX=NXS`.
- [ ] Đăng ký webhook endpoint tại SePay: `https://<API_DOMAIN>/v1/webhooks/payments/sepay` với phương thức xác thực `API Key` (chuỗi >= 24 ký tự).
- [ ] Thử nghiệm chuyển khoản thử nghiệm **2,000 VND** từ app ngân hàng thực tế.
- [ ] Xác minh SePay webhook gửi về, order tự động chuyển từ `PENDING` sang `PAID`, sinh `Entitlement` và `License`.

## 6. Security & Invariants
- [ ] Khóa `LICENSE_KEY_ENCRYPTION_KEY` gồm đúng 64 ký tự hex (32 bytes).
- [ ] Khóa `AUTOMATION_SERVICE_SECRET` có độ dài tối thiểu 32 ký tự.
- [ ] Feature Flags đang tắt hoàn toàn:
  - `FEATURE_HOSTING=false`
  - `FEATURE_MEMBERSHIP=false`
  - `FEATURE_AFFILIATE=false`
  - `FEATURE_FINANCE=false`
- [ ] Thử nghiệm CORS: Request từ domain lạ hoặc `http://localhost` bị từ chối 403/Blocked.

## 7. Operational Readiness
- [ ] Script backup database (`infra/scripts/backup-db.sh`) chạy thử thành công, tạo ra file `.sql.gz` và `.sha256`.
- [ ] Script restore database (`infra/scripts/restore-db.sh`) được kiểm tra trên database phụ thành công.
- [ ] Endpoint `/health/readiness` trả về HTTP 200 `{ "status": "ok" }` cho cả DB, Redis và Storage.
- [ ] Worker container đang lắng nghe hàng đợi BullMQ và xử lý các sự kiện Outbox.
