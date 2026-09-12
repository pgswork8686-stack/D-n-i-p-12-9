# NEXUSTHEME — Digital Product Commerce Platform (Phase 1 Foundation)

Hệ thống thương mại số cho phép phân phối Theme, Plugin, Figma UI Kit, License phần mềm và Cloud Hosting.
Kiến trúc định hướng **3 Frontend + 1 API + Worker + Microservices Storage/Queue**.

---

## 1. Yêu cầu môi trường (Prerequisites)

- **Node.js**: `v20.x` hoặc `v24.x` (khuyến nghị `v24.19.0+`)
- **pnpm**: `v9.x` hoặc `v11.x` (khuyến nghị `v11.20.0+`)
- **Docker Desktop**: Hỗ trợ Docker Compose v2+

---

## 2. Port Map (Bản Đồ Cổng Dịch Vụ)

| Dịch vụ / Ứng dụng | Đường dẫn / Port | Công nghệ | Mục đích |
|:---|:---|:---|:---|
| **Public Web** | `http://localhost:3000` | Next.js 14 App Router | Marketplace, Search, Catalog, SEO |
| **Customer Portal** | `http://localhost:3001` | Next.js 14 App Router | Quản lý License, Domain, Downloads |
| **Super Admin** | `http://localhost:3002` | Next.js 14 App Router | CMS, Điều phối License, Upstream, Audit |
| **Backend API** | `http://localhost:4000` | NestJS Modular Monolith | Health, Storage, Auth Guard, Business Core |
| **PostgreSQL** | `localhost:5432` | PostgreSQL 16 Alpine | Primary Relational DB & Source of Truth |
| **Redis** | `localhost:6379` | Redis 7 Alpine | Cache, Lock & BullMQ Broker |
| **MinIO S3 API** | `http://localhost:9000` | MinIO Storage | Giả lập Cloudflare R2 / Private Storage |
| **MinIO Console** | `http://localhost:9001` | MinIO Web GUI | Quản trị bucket (`marketplace-dev`) |

---

## 3. Hướng Dẫn Chạy Local (Quickstart)

### Bước 1: Thiết lập biến môi trường
```bash
cp .env.example .env
```

### Bước 2: Khởi động các dịch vụ hạ tầng Docker
```bash
docker compose up -d
```
*Lệnh này sẽ tự động khởi tạo Postgres, Redis, MinIO và chạy container `minio-init` để tạo sẵn bucket `marketplace-dev`.*

### Bước 3: Cài đặt dependencies
```bash
pnpm install
```

### Bước 4: Khởi tạo Database Schema (Prisma)
```bash
pnpm --filter @nexus/database prisma:generate
# Chạy migration khi Postgres đã sẵn sàng:
pnpm --filter @nexus/database prisma:migrate
```

### Bước 5: Chạy toàn bộ ứng dụng ở chế độ dev
```bash
pnpm dev
```

---

## 4. Các Lệnh Kiểm Tra Chất Lượng (Quality Gates)

Dự án sử dụng Turborepo để điều phối chạy đồng loạt trên toàn bộ monorepo:

```bash
# Kiểm tra định dạng và chuẩn code
pnpm lint

# Kiểm tra TypeScript Strict Mode toàn bộ apps và packages
pnpm typecheck

# Chạy toàn bộ unit test (API, Worker, Auth, Utils)
pnpm test

# Build toàn bộ packages và production apps
pnpm build
```

---

## 5. API Health Check Endpoints

Backend API cung cấp các endpoint kiểm tra trạng thái dependency thực tế (không hard-code):

- `GET http://localhost:4000/health`: Tổng hợp trạng thái toàn hệ thống (Database, Redis, Storage).
- `GET http://localhost:4000/health/db`: Ping trực tiếp PostgreSQL thông qua Prisma query.
- `GET http://localhost:4000/health/redis`: Ping trực tiếp Redis instance.
- `GET http://localhost:4000/health/storage`: Kiểm tra kết nối S3/MinIO bucket.

Mẫu JSON response machine-readable:
```json
{
  "status": "ok",
  "service": "api",
  "version": "0.1.0",
  "timestamp": "2026-09-12T07:15:00.000Z",
  "dependencies": {
    "database": { "status": "ok", "latencyMs": 4 },
    "redis": { "status": "ok", "latencyMs": 2 },
    "storage": { "status": "ok", "latencyMs": 11 }
  }
}
```

---

## 6. Known Limitations của Phase 1

1. **Phạm vi giao diện**: Phase 1 chỉ tạo các trang landing tối giản kèm chỉ báo kết nối API để xác nhận plumbing. 36 file giao diện mẫu HTML/Stitch chưa được đưa vào production ở phase này.
2. **Auth**: Sử dụng tầng trừu tượng `DevMockAuthProvider` cho môi trường development (header: `Authorization: Bearer dev-admin-token` hoặc `dev-user-token`). Phase 2 sẽ tích hợp Supabase Auth JWT verification chính thức.
3. **Commerce & Payment**: Chưa bao gồm các bảng thanh toán phức tạp, cổng VNPay/Momo/Stripe, hay logic cấp license thật.
4. **Automation / n8n**: Thư mục `automation/n8n` chỉ đóng vai trò tài liệu định hướng; chưa triển khai workflow tự động hóa n8n.
