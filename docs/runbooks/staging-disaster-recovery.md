# Staging Disaster Recovery Runbook

Runbook hướng dẫn quy trình ứng phó và khắc phục sự cố (Disaster Recovery - DR) trên môi trường Staging.
Mục tiêu SLA: **RPO < 15 phút**, **RTO < 30 phút**.

---

## 1. Phục hồi cơ sở dữ liệu PostgreSQL (Database Restore)

### Kịch bản
Database bị hỏng, lỗi migration, hoặc dữ liệu bị sai lệch nghiêm trọng.

### Quy trình thực hiện
1. **Dừng các ứng dụng ghi dữ liệu (API & Worker):**
   ```bash
   docker compose -f infra/docker/production-compose.yml stop api worker
   ```
2. **Xác minh file backup hợp lệ và toàn vẹn:**
   ```bash
   ./infra/scripts/verify-backup.sh ./backups/nexustheme_marketplace_YYYYMMDD_HHMMSS.sql.gz
   ```
3. **Thực hiện Restore:**
   ```bash
   ./infra/scripts/restore-db.sh ./backups/nexustheme_marketplace_YYYYMMDD_HHMMSS.sql.gz --force
   ```
4. **Kiểm tra trạng thái sau restore:**
   - Số lượng table public phải đầy đủ (~37 tables).
   - Kiểm tra healthcheck:
     ```bash
     docker compose -f infra/docker/production-compose.yml exec postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB
     ```
5. **Khởi động lại API và Worker:**
   ```bash
   docker compose -f infra/docker/production-compose.yml start api worker
   ```

---

## 2. Khắc phục sự cố Cloudflare R2 (Storage Outage / Recovery)

### Kịch bản
R2 bucket bị xóa nhầm, credentials bị thu hồi, hoặc endpoint R2 gặp sự cố kết nối.

### Quy trình xử lý
1. Kiểm tra trạng thái Storage qua health endpoint:
   ```bash
   curl -s http://127.0.0.1:4000/health/readiness | jq .dependencies.storage
   ```
2. **Nếu lỗi do Access Key/Secret Key:**
   - Cấp phát API Token mới từ Cloudflare Dashboard (quyền Admin-read-write trên bucket chỉ định).
   - Cập nhật `.env.production`:
     ```env
     STORAGE_ACCESS_KEY=<new_access_key>
     STORAGE_SECRET_KEY=<new_secret_key>
     ```
   - Restart API container:
     ```bash
     docker compose -f infra/docker/production-compose.yml up -d --no-deps api
     ```
3. **Nếu bucket bị mất dữ liệu file:**
   - Khôi phục các asset gói cài đặt mẫu (WordPress ZIP test plugin) bằng cách upload lại từ kho lưu trữ release qua script hoặc admin panel.

---

## 3. Quản lý và xử lý khóa License Key (`LICENSE_KEY_ENCRYPTION_KEY`)

### Cảnh báo nghiêm ngặt
`LICENSE_KEY_ENCRYPTION_KEY` là khóa 32 bytes (64 hex characters) dùng để mã hóa AES-256-GCM các license key của khách hàng.
**TUYỆT ĐỐI KHÔNG ROTATE HOẶC THAY ĐỔI KHÓA NÀY KHI ĐÃ CÓ DỮ LIỆU LICENSE THẬT**, nếu không toàn bộ license cũ trong DB sẽ không thể giải mã (`decryption failed: invalid key or tampered ciphertext`).

### Quy trình sao lưu khóa
- Lưu trữ khóa tại Password Manager / Vault bí mật của tổ chức.
- Khi tạo môi trường staging mới từ bản snapshot backup DB của môi trường khác, **bắt buộc** phải dùng cùng `LICENSE_KEY_ENCRYPTION_KEY`.

---

## 4. Xử lý mất mát / Treo Redis Cache & Queue

### Kịch bản
Redis container bị crash, out-of-memory, hoặc mất dữ liệu cache.

### Quy trình xử lý
1. Redis được cấu hình AOF (`--appendonly yes`) và volume persistent `redis_data`.
2. Khởi động lại Redis:
   ```bash
   docker compose -f infra/docker/production-compose.yml restart redis
   ```
3. Sau khi Redis sẵn sàng, Worker sẽ tự động reconnect mà không làm mất job vì Outbox Pattern lưu sự kiện bền vững trong PostgreSQL:
   ```bash
   docker compose -f infra/docker/production-compose.yml restart worker
   ```

---

## 5. Rollback phiên bản ứng dụng (Application Rollback)

### Kịch bản
Bản build mới phát sinh lỗi runtime nghiêm trọng trên API hoặc Frontend.

### Quy trình xử lý
1. Không chạy rollback database ngược chiều (`prisma migrate down` không được hỗ trợ chính thức).
2. Kiểm tra Git SHA phiên bản ổn định trước đó:
   ```bash
   git log --oneline -5
   ```
3. Checkout lại commit ổn định:
   ```bash
   git checkout <PREVIOUS_COMMIT_SHA>
   ```
4. Rebuild và triển khai lại container tương ứng:
   ```bash
   docker compose -f infra/docker/production-compose.yml up -d --build api web portal admin worker
   ```
5. Kiểm tra health endpoints để xác nhận hệ thống đã phục hồi:
   ```bash
   curl -f http://127.0.0.1:4000/health/liveness
   curl -f http://127.0.0.1:4000/health/readiness
   ```
