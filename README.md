# NexusTheme — Chợ sản phẩm số (theme, plugin, UI kit, license)

Monorepo gồm **3 frontend Next.js + 1 API NestJS + 1 worker**, dùng PostgreSQL, Redis và lưu trữ S3 (R2/MinIO).
Đăng nhập qua Supabase. Thanh toán **VietQR qua SePay** (mặc định), **Stripe** là tuỳ chọn.

| App | Port dev | Vai trò |
| :-- | :-- | :-- |
| `apps/web` | 3000 | Cửa hàng tiếng Việt: danh mục, chi tiết, giỏ hàng, checkout, trang thanh toán QR, blog |
| `apps/portal` | 3001 | Tài khoản khách: đơn hàng, tải xuống, license, kích hoạt tên miền, ticket |
| `apps/admin` | 3002 | Quản trị: sản phẩm, phiên bản/file, nội dung CMS, automation |
| `apps/api` | 4000 | NestJS — nguồn quyết định duy nhất cho giá, đơn, thanh toán, quyền |
| `apps/worker` | — | Outbox: cấp entitlement, license, email, xuất bản bài hẹn giờ |

## Trạng thái module

| Module | Trạng thái production |
| :-- | :-- |
| Catalog, giỏ hàng, đơn hàng, thanh toán SePay/Stripe | ✅ Sẵn sàng |
| Entitlement, license nội bộ, tải file có ký số, cập nhật plugin | ✅ Sẵn sàng |
| License quản lý hộ (Elementor…) — duyệt tay | ✅ Sẵn sàng (xem lưu ý pháp lý bên dưới) |
| CMS/SEO, blog, n8n automation | ✅ Sẵn sàng |
| Helpdesk / ticket, thông báo | ✅ Sẵn sàng |
| Hosting, Membership, Affiliate, Kế toán/Thuế | ⛔ Tắt bằng feature flag (`FEATURE_*`) — chưa hoàn thiện |

Lưu ý: bán quyền dùng từ một tài khoản Elementor Pro dùng chung có thể vi phạm điều khoản của nhà cung cấp. Hãy kiểm tra hợp đồng hoặc chương trình reseller trước khi mở bán loại sản phẩm này.

## Chạy local

Yêu cầu: Node.js ≥ 22.13, pnpm 11, Docker.

```bash
cp .env.example .env            # bật thêm ENABLE_TEST_PAYMENT_PROVIDER=true, SEED_DEV_USERS=true khi dev
docker compose up -d            # Postgres, Redis, MinIO
pnpm install
pnpm db:migrate
pnpm db:seed:local              # RBAC + user dev + catalog mẫu (bị chặn khi NODE_ENV=production)
pnpm dev
```

- Đăng nhập dev: đặt `NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS=true`, vào `/login` rồi dùng token `dev-user-token` / `dev-admin-token`. Chức năng này chỉ có khi không phải production.
- Thử thanh toán VietQR ở local: điền các biến `SEPAY_*` (số tài khoản bất kỳ), đặt hàng, sau đó giả lập ngân hàng:

```bash
curl -X POST http://localhost:4000/v1/webhooks/payments/sepay \
  -H "Authorization: Apikey $SEPAY_WEBHOOK_API_KEY" -H "Content-Type: application/json" \
  -d '{"id":1,"transferType":"in","accountNumber":"<SEPAY_BANK_ACCOUNT>","transferAmount":<số tiền>,"content":"<nội dung CK>"}'
```

## Kiểm tra chất lượng

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:acceptance:phase4   # ... đến phase18 (cần Postgres/Redis/MinIO)
```

CI (`.github/workflows/ci.yml`) chạy toàn bộ các bước trên với Node 22 và build cả 6 Docker image. Hãy bật **branch protection** cho `main` và yêu cầu check `CI` phải xanh trước khi merge.

## Triển khai production

Làm theo [docs/production-cutover-runbook.md](docs/production-cutover-runbook.md): một máy chủ Docker, Caddy tự cấp HTTPS, cấu hình trong `.env.production` (mẫu: [.env.production.example](.env.production.example)).

```bash
docker compose -f infra/docker/production-compose.yml --env-file .env.production up -d --build
```

## Nguyên tắc bất biến

1. Backend là nơi duy nhất quyết định giá, trạng thái đơn, thanh toán và quyền. Frontend chỉ hiển thị.
2. Đơn chỉ chuyển sang `PAID` khi có webhook đã xác thực (SePay API key / chữ ký Stripe) hoặc khi đối soát chủ động với cổng thanh toán. Trang "thanh toán thành công" trên trình duyệt không bao giờ được tính là bằng chứng.
3. Chuyển khoản sai số tiền hoặc sai nội dung **không** được tự động xác nhận; những giao dịch này phải đối soát tay.
4. File gốc không bao giờ public. Tải file luôn qua kiểm tra quyền và URL ký số có hạn 2–5 phút.
5. API fail-closed khi khởi động nếu cấu hình production không an toàn.
