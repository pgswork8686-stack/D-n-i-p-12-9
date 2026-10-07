# MVP Cutover Plan

Kế hoạch chuyển đổi và đưa hệ thống lên Staging / Production Pilot.

---

## Mốc thời gian & Quy trình chi tiết

### Giai đoạn 1: T - 24 Giờ (Chuẩn bị hạ tầng & Dịch vụ ngoài)
1. **Thiết lập DNS:**
   - Tạo các A record trỏ các domain staging (`web`, `portal`, `admin`, `api`) về IP của VPS.
2. **Khởi tạo dịch vụ bên thứ ba:**
   - **Supabase:** Tạo project staging, lấy URL, Anon Key, và Service Role Key.
   - **Cloudflare R2:** Tạo bucket private (ví dụ `nexustheme-staging-private`), cấp API Token S3-compatible.
   - **SePay:** Tạo tích hợp ngân hàng, thiết lập mã thanh toán prefix `NXS`, cấu hình Webhook URL trỏ về `https://<API_DOMAIN>/v1/webhooks/payments/sepay`.
3. **Chuẩn bị cấu hình server:**
   - Tạo file `.env.production` trên VPS dựa trên template `.env.production.example`.

### Giai đoạn 2: T - 1 Giờ (Triển khai & Bootstrap dữ liệu)
1. **Pull mã nguồn hoặc Docker images:**
   ```bash
   git fetch --all
   git checkout <TARGET_STAGING_SHA>
   ```
2. **Khởi động Database & Redis:**
   ```bash
   docker compose -f infra/docker/production-compose.yml --env-file .env.production up -d postgres redis
   ```
3. **Thực thi Migration & Seed hệ thống:**
   ```bash
   docker compose -f infra/docker/production-compose.yml --env-file .env.production run --rm migrate
   ```
4. **Khởi động API, Worker và Next.js Frontend:**
   ```bash
   docker compose -f infra/docker/production-compose.yml --env-file .env.production up -d --build api worker web portal admin
   ```
5. **Khởi động Reverse Proxy (Caddy):**
   ```bash
   docker compose -f infra/docker/production-compose.yml --env-file .env.production up -d caddy
   ```

### Giai đoạn 3: T - 0 (Kiểm thử thực tế - Smoke & Real Payment)
1. **Kiểm tra Health endpoints:**
   ```bash
   curl -fsS https://<API_DOMAIN>/health/liveness
   curl -fsS https://<API_DOMAIN>/health/readiness
   ```
2. **Kiểm tra luồng đăng ký & đăng nhập thực tế:**
   - Đăng ký user test qua giao diện Storefront.
   - Kiểm tra user record được tạo trong Supabase Auth và đồng bộ sang database local `users`.
3. **Kiểm tra giao dịch thật (Real Money Flow):**
   - Đặt đơn hàng sản phẩm thử nghiệm giá **2,000 VND**.
   - Người dùng quét VietQR từ app ngân hàng thực tế để thanh toán.
   - Chờ SePay bắn webhook về API -> Kiểm tra đơn hàng đổi sang `PAID`.
   - Xác nhận `Entitlement` và `InternalLicense` được tạo trong cơ sở dữ liệu.
   - Tải file ZIP sản phẩm qua signed download URL của R2 và kiểm tra toàn vẹn file.

### Giai đoạn 4: Hậu chuyển đổi (Post-Cutover Monitoring)
- Theo dõi logs của container `api`, `worker`, và `caddy`:
  ```bash
  docker compose -f infra/docker/production-compose.yml logs -f --tail=100
  ```
- Kiểm tra metric kết nối Redis và DB connection pool.
- Chạy backup cơ sở dữ liệu ban đầu lưu trữ.

---

## Tiêu chí Rollback khẩn cấp (Rollback Criteria)
Kích hoạt rollback về phiên bản trước hoặc bật maintenance mode nếu:
1. Xác thực Supabase Auth thất bại liên tục (401/500 trên luồng login/signup).
2. SePay webhook không thể nhận diện thanh toán hoặc đổi trạng thái đơn hàng sai.
3. Cấp phát license hoặc sinh signed URL download R2 bị lỗi hệ thống.
4. Database migration làm hỏng dữ liệu hoặc service không thể kết nối DB/Redis.
