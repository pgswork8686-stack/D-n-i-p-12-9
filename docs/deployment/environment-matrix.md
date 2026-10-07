# Environment Matrix

Bảng đối chiếu toàn bộ các biến môi trường thực tế được sử dụng trong codebase của NexusTheme monorepo.

---

## 1. Phân loại biến môi trường

- **REQUIRED_PRODUCTION**: Bắt buộc phải có giá trị hợp lệ khi `NODE_ENV=production`. Thiếu sẽ fail-closed (crash lúc khởi động hoặc từ chối request).
- **OPTIONAL**: Tùy chọn, ứng dụng hoạt động bình thường nếu bỏ trống.
- **FEATURE_FLAG**: Cờ bật/tắt tính năng. Mặc định `false` trong production.
- **DEV_ONLY**: Chỉ dùng cho môi trường local development hoặc test suite; cấm bật trong staging/production.
- **SECRET**: Giá trị nhạy cảm (Private Key, Password, Service Role Key, Database URL, v.v.). Tuyệt đối không commit hoặc expose ra client.
- **PUBLIC**: Biến public an toàn, có thể dùng ở frontend Next.js với tiền tố `NEXT_PUBLIC_`.

---

## 2. Bảng biến môi trường chi tiết

| Biến môi trường | Dịch vụ sử dụng | Phân loại | Tính bảo mật | Ví dụ cấu hình Staging | Nguồn cấu hình | Fail-Closed Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | All | REQUIRED_PRODUCTION | PUBLIC | `production` | `.env.production` | Mặc định chuyển sang chế độ production an toàn |
| `WEB_DOMAIN` | Caddy, Compose | REQUIRED_PRODUCTION | PUBLIC | `staging.nexustheme.vn` | `.env.production` | Caddy không start được hoặc không issue cert |
| `PORTAL_DOMAIN` | Caddy, Compose | REQUIRED_PRODUCTION | PUBLIC | `app-staging.nexustheme.vn` | `.env.production` | Caddy lỗi config |
| `ADMIN_DOMAIN` | Caddy, Compose | REQUIRED_PRODUCTION | PUBLIC | `admin-staging.nexustheme.vn` | `.env.production` | Caddy lỗi config |
| `API_DOMAIN` | Caddy, Compose | REQUIRED_PRODUCTION | PUBLIC | `api-staging.nexustheme.vn` | `.env.production` | Caddy lỗi config |
| `ACME_EMAIL` | Caddy | REQUIRED_PRODUCTION | PUBLIC | `ops@nexustheme.vn` | `.env.production` | Let's Encrypt không gửi thông báo chứng chỉ |
| `POSTGRES_USER` | Postgres, API, Worker, Migrate | REQUIRED_PRODUCTION | PUBLIC | `nexus_staging` | `.env.production` | Postgres container từ chối khởi động |
| `POSTGRES_PASSWORD` | Postgres, API, Worker, Migrate | REQUIRED_PRODUCTION | SECRET | `(random-strong-pw)` | `.env.production` | Compose validation bắt buộc `:?` -> Crash ngay |
| `POSTGRES_DB` | Postgres, API, Worker, Migrate | REQUIRED_PRODUCTION | PUBLIC | `marketplace_staging` | `.env.production` | Postgres không tạo database |
| `REDIS_PASSWORD` | Redis, API, Worker | REQUIRED_PRODUCTION | SECRET | `(random-strong-pw)` | `.env.production` | Compose validation bắt buộc `:?` -> Crash ngay |
| `DATABASE_URL` | API, Worker, Migrate, DB scripts | REQUIRED_PRODUCTION | SECRET | `postgresql://${USER}:${PW}@postgres:5432/${DB}` | Compose interpolation | Prisma client lỗi kết nối ngay |
| `REDIS_URL` | API, Worker | REQUIRED_PRODUCTION | SECRET | `redis://:${PW}@redis:6379` | Compose interpolation | Worker & Health check báo lỗi kết nối |
| `WEB_URL` | API | REQUIRED_PRODUCTION | PUBLIC | `https://${WEB_DOMAIN}` | Compose interpolation | CORS check fail-closed, ném exception lúc boot |
| `PORTAL_URL` | API | REQUIRED_PRODUCTION | PUBLIC | `https://${PORTAL_DOMAIN}` | Compose interpolation | CORS check fail-closed, ném exception lúc boot |
| `ADMIN_URL` | API | REQUIRED_PRODUCTION | PUBLIC | `https://${ADMIN_DOMAIN}` | Compose interpolation | CORS check fail-closed, ném exception lúc boot |
| `API_URL` | API, Web, Portal, Admin | REQUIRED_PRODUCTION | PUBLIC | `https://${API_DOMAIN}` | Compose interpolation | Next.js API client không gọi được API |
| `SUPABASE_URL` | API, Web, Portal, Admin | REQUIRED_PRODUCTION | PUBLIC | `https://xxxx.supabase.co` | `.env.production` | API Auth provider chuyển sang fail-closed |
| `SUPABASE_ANON_KEY` | Web, Portal, Admin | REQUIRED_PRODUCTION | PUBLIC | `eyJhbGciOi...` | `.env.production` | Client Supabase không khởi tạo được session |
| `SUPABASE_SERVICE_ROLE_KEY` | API | REQUIRED_PRODUCTION | SECRET | `eyJhbGciOi...` | `.env.production` | API AuthGuard từ chối mọi token |
| `LICENSE_KEY_ENCRYPTION_KEY` | API, Worker, DB | REQUIRED_PRODUCTION | SECRET | `(64 hex chars = 32 bytes)` | `.env.production` | `getEncryptionKey()` ném exception khi cấp phát license |
| `AUTOMATION_SERVICE_SECRET` | API, Worker | REQUIRED_PRODUCTION | SECRET | `(>= 32 chars random)` | `.env.production` | HMAC validation ném exception nếu < 32 chars |
| `STORAGE_PROVIDER` | API | REQUIRED_PRODUCTION | PUBLIC | `s3` | `.env.production` | Storage service ném exception lúc boot |
| `STORAGE_ENDPOINT` | API | REQUIRED_PRODUCTION | PUBLIC | `https://<id>.r2.cloudflarestorage.com` | `.env.production` | Storage service ném exception lúc boot |
| `STORAGE_BUCKET` | API | REQUIRED_PRODUCTION | PUBLIC | `nexus-staging-private` | `.env.production` | Storage service ném exception lúc boot |
| `STORAGE_ACCESS_KEY` | API | REQUIRED_PRODUCTION | SECRET | `(cloudflare-r2-access-key)` | `.env.production` | Storage service ném exception lúc boot |
| `STORAGE_SECRET_KEY` | API | REQUIRED_PRODUCTION | SECRET | `(cloudflare-r2-secret-key)` | `.env.production` | Storage service ném exception lúc boot |
| `STORAGE_REGION` | API | OPTIONAL | PUBLIC | `auto` | `.env.production` | Mặc định fallback `auto` |
| `MAX_UPLOAD_BYTES` | API | OPTIONAL | PUBLIC | `52428800` (50MB) | `.env.production` | Mặc định fallback 50MB |
| `SEPAY_BANK_CODE` | API | REQUIRED_PRODUCTION | PUBLIC | `MBBank` | `.env.production` | SePay provider fail-closed nếu cấu hình nửa chừng |
| `SEPAY_BANK_ACCOUNT` | API | REQUIRED_PRODUCTION | PUBLIC | `0987654321` | `.env.production` | SePay provider fail-closed nếu cấu hình nửa chừng |
| `SEPAY_ACCOUNT_NAME` | API | REQUIRED_PRODUCTION | PUBLIC | `CONG TY CO PHAN NEXUS` | `.env.production` | SePay provider fail-closed nếu cấu hình nửa chừng |
| `SEPAY_WEBHOOK_API_KEY` | API | REQUIRED_PRODUCTION | SECRET | `(>= 24 chars random)` | `.env.production` | SePay crash boot nếu thiếu hoặc < 24 chars |
| `SEPAY_API_TOKEN` | API | OPTIONAL | SECRET | `(sepay-api-token)` | `.env.production` | Tắt tính năng tự query reconciliation |
| `SEPAY_PAYMENT_CODE_PREFIX` | API | OPTIONAL | PUBLIC | `NXS` | `.env.production` | Mặc định dùng `NXS`, phải từ 2-6 ký tự |
| `STRIPE_SECRET_KEY` | API | OPTIONAL | SECRET | Bỏ trống nếu không dùng | `.env.production` | Nếu có 1 trong 2 key sẽ fail-closed |
| `STRIPE_WEBHOOK_SECRET` | API | OPTIONAL | SECRET | Bỏ trống nếu không dùng | `.env.production` | Nếu có 1 trong 2 key sẽ fail-closed |
| `FEATURE_HOSTING` | API, Worker | FEATURE_FLAG | PUBLIC | `false` | `.env.production` | Mọi API hosting trả về 404 |
| `FEATURE_MEMBERSHIP` | API, Worker | FEATURE_FLAG | PUBLIC | `false` | `.env.production` | API membership trả về 404 |
| `FEATURE_AFFILIATE` | API, Worker | FEATURE_FLAG | PUBLIC | `false` | `.env.production` | API affiliate trả về 404 |
| `FEATURE_FINANCE` | API, Worker | FEATURE_FLAG | PUBLIC | `false` | `.env.production` | API finance trả về 404 |
| `ENABLE_TEST_PAYMENT_PROVIDER` | API | DEV_ONLY | PUBLIC | `false` | Cấm bật ở production | Bị cấm bởi `NODE_ENV === "production"` |
| `STRIPE_MOCK_CLIENT` | API | DEV_ONLY | PUBLIC | `false` | Cấm bật ở production | Ném lỗi crash nếu bật trong production |
| `SEED_DEV_USERS` | DB seed | DEV_ONLY | PUBLIC | `false` | Cấm bật ở production | Không tạo user mock |
| `NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS` | Web, Portal, Admin | DEV_ONLY | PUBLIC | `false` | Cấm bật ở production | Ẩn toàn bộ switch giả lập token |
