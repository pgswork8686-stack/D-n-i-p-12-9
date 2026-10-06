# Runbook triển khai production — NexusTheme

Mô hình: **1 máy chủ Linux** (tối thiểu 2 vCPU / 4 GB RAM, khuyến nghị 4 vCPU / 8 GB) chạy Docker Compose.
Caddy tự cấp HTTPS. File riêng tư nằm trên Cloudflare R2, đăng nhập dùng Supabase, thanh toán qua SePay (VietQR), Stripe là tuỳ chọn.

| Tên miền | Ứng dụng | Container |
| :-- | :-- | :-- |
| `WEB_DOMAIN` (vd `nexustheme.vn`) | Cửa hàng | `web:3000` |
| `PORTAL_DOMAIN` (vd `app.nexustheme.vn`) | Trang tài khoản khách | `portal:3001` |
| `ADMIN_DOMAIN` (vd `admin.nexustheme.vn`) | Quản trị | `admin:3002` |
| `API_DOMAIN` (vd `api.nexustheme.vn`) | API + webhook | `api:4000` |
| (nội bộ) | Worker cấp quyền/license | `worker` |

---

## 1. Chuẩn bị tài khoản bên ngoài (làm một lần)

1. **Tên miền & DNS**: tạo bản ghi `A` cho 4 tên miền trỏ về IP máy chủ, cộng thêm `www.WEB_DOMAIN`. Nếu dùng Cloudflare proxy, đặt SSL mode = **Full (strict)**.
2. **Supabase**: tạo project → Authentication → bật Email. Thêm `https://WEB_DOMAIN/login` và `https://PORTAL_DOMAIN/login` vào *Redirect URLs*. Lấy `URL`, `anon key`, `service_role key`.
3. **Cloudflare R2**: tạo bucket **private** (không bật public access) và API token có quyền Object Read & Write cho bucket đó.
4. **SePay** (https://my.sepay.vn):
   - Liên kết tài khoản ngân hàng nhận tiền.
   - *Cấu hình mã thanh toán*: tiền tố trùng với `SEPAY_PAYMENT_CODE_PREFIX` (mặc định `NXS`).
   - *WebHooks* → Thêm: URL `https://API_DOMAIN/v1/webhooks/payments/sepay`, sự kiện **Có tiền vào**, xác thực **API Key** (chuỗi ≥ 24 ký tự, sinh bằng `openssl rand -hex 24`). Đặt cùng giá trị vào `SEPAY_WEBHOOK_API_KEY`.
   - (Tuỳ chọn) tạo API Token → `SEPAY_API_TOKEN` để nút “Tôi đã chuyển khoản” kiểm tra ngay.
5. **Stripe** (tuỳ chọn, chỉ khi có pháp nhân ở nước Stripe hỗ trợ): key `sk_live_…`, webhook `https://API_DOMAIN/v1/webhooks/payments/stripe` với các sự kiện `checkout.session.completed`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Không dùng Stripe thì **để trống cả hai** biến.

## 2. Cài máy chủ

```bash
# Ubuntu 24.04
curl -fsSL https://get.docker.com | sh
git clone <repo> /opt/nexustheme && cd /opt/nexustheme
cp .env.production.example .env.production
nano .env.production      # điền MỌI giá trị; sinh secret bằng: openssl rand -hex 32
chmod 600 .env.production
```

> `LICENSE_KEY_ENCRYPTION_KEY` **không được đổi** sau khi đi vào hoạt động. Hãy sao lưu nó ở nơi an toàn (trình quản lý mật khẩu). Mất key này thì mọi license đã cấp đều không giải mã được.

## 3. Khởi chạy

```bash
docker compose -f infra/docker/production-compose.yml --env-file .env.production up -d --build
docker compose -f infra/docker/production-compose.yml --env-file .env.production ps
```

Thứ tự khởi động diễn ra tự động: `postgres`/`redis` → `migrate` (`prisma migrate deploy` và seed RBAC, rồi thoát) → `api` (chờ healthcheck) → `worker`/`web`/`portal`/`admin` → `caddy`.

API **từ chối khởi động** (fail-closed) nếu thiếu cấu hình bắt buộc, ví dụ CORS origin không phải HTTPS, SePay chỉ cấu hình một nửa, hoặc Stripe dùng key test. Khi gặp lỗi, xem log bằng:

```bash
docker compose -f infra/docker/production-compose.yml logs --tail=100 api migrate
```

## 4. Tạo tài khoản quản trị

1. Đăng ký tài khoản tại `https://WEB_DOMAIN/register`, xác nhận email, rồi **đăng nhập một lần** (lần đăng nhập đầu tiên sẽ tạo user trong database).
2. Gán quyền `super_admin`:

```bash
docker compose -f infra/docker/production-compose.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "INSERT INTO user_roles (id, user_id, role_id) SELECT gen_random_uuid()::text, u.id, r.id FROM users u, roles r WHERE u.email='ban@email.vn' AND r.name='super_admin' ON CONFLICT (user_id, role_id) DO NOTHING;"
```

3. Đăng nhập `https://ADMIN_DOMAIN`, tạo danh mục, sản phẩm, giá **VND**, upload file phiên bản rồi **Publish**.

## 5. Kiểm tra trước khi mở bán

```bash
curl -fsS https://API_DOMAIN/health/readiness     # database/redis/storage đều phải "ok"
curl -fsS https://API_DOMAIN/v1/payments/providers # phải có "sepay"
curl -fsS https://API_DOMAIN/v1/features           # các module chưa hoàn thiện phải là false
```

**Mua thử bằng tiền thật**: tạo một sản phẩm giá 2.000đ rồi mua bằng một tài khoản khách. Quét QR và chuyển khoản. Trong vòng 1 phút đơn phải chuyển sang *Đã thanh toán*, và mục *Tải xuống / License* trong portal phải có hàng. Kiểm tra lịch sử webhook trên SePay: phải trả về `{"success":true}`.

## 6. Vận hành hằng ngày

| Việc | Lệnh / nơi xem |
| :-- | :-- |
| Log | `docker compose -f infra/docker/production-compose.yml logs -f api worker` |
| Chuyển khoản sai số tiền / sai nội dung | Hệ thống **không** tự xác nhận. Log có `sepay_webhook_ignored`. Đối soát tay trên SePay rồi hoàn tiền hoặc liên hệ khách. |
| Cập nhật code | `git pull && docker compose ... up -d --build` (migrate tự chạy trước API) |
| Bật một module khi đã hoàn thiện | Sửa `FEATURE_*=true` trong `.env.production` rồi chạy `up -d` |

### Sao lưu (cron hằng giờ)

```bash
mkdir -p /var/backups/nexustheme
docker compose -f /opt/nexustheme/infra/docker/production-compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip -9 > /var/backups/nexustheme/db_$(date -u +%Y%m%d_%H%M).sql.gz
find /var/backups/nexustheme -name 'db_*.sql.gz' -mtime +14 -delete
```

Ngoài ra, hãy sao chép thư mục backup lên R2 hoặc một máy khác. **Mỗi tháng diễn tập khôi phục một lần** trên máy thử:

```bash
gunzip -c db_YYYYMMDD_HHMM.sql.gz | docker compose ... exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## 7. Khi có sự cố

| Tình huống | Xử lý |
| :-- | :-- |
| `migrate` lỗi | Dừng lại, đừng chạy API. Khôi phục bản backup gần nhất, sửa lỗi migration rồi deploy lại. |
| API không healthy | `logs api`. Thường do biến môi trường bị thiếu (API báo đích danh tên biến). |
| Webhook SePay báo lỗi 401 | Key ở SePay khác `SEPAY_WEBHOOK_API_KEY`. |
| Khách đã trả tiền nhưng đơn vẫn chờ | Kiểm tra lịch sử webhook trên SePay. Admin có thể gọi `POST /v1/payments/:id/reconcile` (quyền `payment.manage`) khi đã có `SEPAY_API_TOKEN`. |
| Cần rollback code | `git checkout <tag-trước>` rồi `up -d --build`. Các migration chỉ thêm (additive) nên bản cũ vẫn chạy được trên schema mới. |
