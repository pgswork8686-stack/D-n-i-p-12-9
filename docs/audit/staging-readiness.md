# Staging Readiness Report

- **Date:** 2026-10-07
- **Target Repository:** `https://github.com/pgswork8686-stack/D-n-i-p-12-9`
- **Main Commit SHA:** `b34047673fef045a85d9b182712d3ad5d8215095` (Merge PR #24)
- **Local Working Branch:** `chore/staging-pilot` (Head: `6484bd4`, tree: `e16dc9e85ee5fa68b7f2a0b682ed17089a600f5f` matching origin/main)
- **Status Classification:** `STAGING READY` (Blocked by external live credentials for real staging rollout)

---

## 1. Executive Summary

Hệ thống đã đạt trạng thái **CI PROVEN** trên GitHub Actions (`Run #37571516340`, 7/7 checks green, Phase 4 → 18 acceptance suites pass).
Audit toàn diện cấu trúc codebase, compose file, bảo mật secret, và các adapter cho thấy:
1. Docker build multi-stage (`infra/docker/Dockerfile`), compose orchestration (`infra/docker/production-compose.yml`), và reverse-proxy (`infra/docker/Caddyfile`) đã được cấu hình chặt chẽ với zero public database/redis ports.
2. Mã nguồn tuân thủ nghiêm ngặt nguyên tắc **fail-closed**:
   - Thiếu cấu hình Supabase trong production -> từ chối auth, không fallback về dev mock token (`ProductionFailClosedAuthProvider`).
   - Cấu hình SePay thiếu field hoặc key < 24 ký tự -> crash ngay lúc khởi động (`resolveConfig`).
   - CORS trong production cấm localhost, cấm HTTP, chỉ chấp nhận các origins HTTPS hợp lệ (`resolveCorsOrigins`).
   - Feature flags (`hosting`, `membership`, `affiliate`, `finance`) mặc định **OFF** trong production mode (`resolveFeatureFlags`).

Hạ tầng hiện tại sẵn sàng 100% để triển khai staging ngay khi người dùng cấp credentials thật.

---

## 2. Staging Readiness Matrix

| Component | Local CI Status | Production Image Target | External Dependency | Credential Required | Staging Status | Blocker / Gaps | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **API** | PASS (Unit + Smoke) | `Dockerfile:api` | Postgres, Redis, Storage, Auth | `DATABASE_URL`, `REDIS_PASSWORD`, `LICENSE_KEY_ENCRYPTION_KEY` | READY | None (Bootable) | Port 4000, NestJS Fastify/Express, CORS fail-closed |
| **Worker** | PASS (Smoke) | `Dockerfile:worker` | Postgres, Redis | `REDIS_PASSWORD`, `DATABASE_URL`, `AUTOMATION_SERVICE_SECRET` | READY | None | BullMQ queue worker, Outbox processor |
| **Web (Storefront)** | PASS (Build) | `Dockerfile:next (APP=web)` | API, Supabase (Public) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | READY | Needs real domain & Supabase anon key | Next.js Standalone, Vietnamese storefront, Cart & Checkout |
| **Customer Portal** | PASS (Build) | `Dockerfile:next (APP=portal)` | API, Supabase (Public) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | READY | Needs real domain & Supabase anon key | Next.js Standalone, Order & License reveal |
| **Admin Panel** | PASS (Build) | `Dockerfile:next (APP=admin)` | API, Supabase (Public) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | READY | Note: Some admin subpages need Supabase session token | Next.js Standalone, Super admin operations |
| **PostgreSQL** | PASS | `postgres:16-alpine` | Private network | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | READY | None | Isolated internal docker network |
| **Redis** | PASS | `redis:7-alpine` | Private network | `REDIS_PASSWORD` | READY | None | Isolated internal docker network, password-protected |
| **Migration** | PASS | `Dockerfile:migrate` | Postgres | `DATABASE_URL` | READY | None | `prisma migrate deploy && prisma db:seed:system` |
| **Caddy / HTTPS** | Validated (Docker) | `caddy:2-alpine` | Let's Encrypt / ZeroSSL | `WEB_DOMAIN`, `PORTAL_DOMAIN`, `ADMIN_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL` | READY | Needs DNS records pointing to VPS | Automatic HTTPS, Reverse proxy with 503 maintenance mode |
| **Supabase Auth** | PASS (Mock/Unit) | N/A (External SaaS) | Supabase Project | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | BLOCKED | `BLOCKED_BY_EXTERNAL_CREDENTIAL` | Fail-closed provider ready; awaiting project keys |
| **Cloudflare R2** | PASS (MinIO S3) | N/A (External SaaS) | Cloudflare R2 Bucket | `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | BLOCKED | `BLOCKED_BY_EXTERNAL_CREDENTIAL` | S3-compatible service ready; signed URL & SHA256 integrity |
| **SePay (VietQR)** | PASS (Spec/Unit) | N/A (External SaaS) | SePay Account & Bank App | `SEPAY_BANK_CODE`, `SEPAY_BANK_ACCOUNT`, `SEPAY_ACCOUNT_NAME`, `SEPAY_WEBHOOK_API_KEY` | BLOCKED | `BLOCKED_BY_EXTERNAL_CREDENTIAL` | VietQR QR generator, timing-safe webhook auth, amount check |
| **License Engine** | PASS | Embedded API/Worker | Postgres | `LICENSE_KEY_ENCRYPTION_KEY` | READY | 32-byte key generation required | AES-256-GCM encryption with SHA256 hash lookup |
| **Download Signing** | PASS | Embedded API | R2 Storage | R2 credentials | READY | Dependent on R2 storage | Signed URL TTL resolver (60s-86400s, default 3600s) |
| **Backup / DR** | PASS (Scripts) | Linux Host / CLI | Postgres, R2 (optional) | `POSTGRES_PASSWORD`, `BACKUP_R2_BUCKET` (opt) | READY | None | `infra/scripts/backup-db.sh`, `restore-db.sh`, `verify-backup.sh` |

---

## 3. Discovered Security & Operational Guarantees

1. **No Committed Secrets:**
   Đã quét toàn bộ lịch sử git và working tree: Không có private key, JWT secret, hoặc API token nào bị commit ngoài các placeholder test fixture trong acceptance test.
2. **Authority Boundary Invariant:**
   Frontend không thể gửi request tự phong trạng thái `PAID`. Trạng thái `PAID` chỉ được cập nhật thông qua:
   - Webhook SePay được xác thực chữ ký API Key constant-time (`crypto.timingSafeEqual`).
   - Kiểm tra khớp chính xác số tiền chuyển khoản (`payment.amount === amount`).
   - Đảm bảo idempotency tuyệt đối bằng unique constraint `provider_externalEventId` trong bảng `payment_events`.
3. **Database & Network Hardening:**
   Trong `production-compose.yml`, cổng `5432` (Postgres) và cổng `6379` (Redis) không được expose ra ngoài host. Chỉ duy nhất container `caddy` mở port `80` và `443`.
4. **Maintenance Mode Fallback:**
   Tạo cờ `infra/docker/flags/maintenance.on` sẽ khiến Caddy phục vụ 503 cho storefront, portal và admin nhưng giữ nguyên API cho SePay webhook hoạt động liên tục.
