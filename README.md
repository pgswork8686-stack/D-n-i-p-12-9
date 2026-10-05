# NEXUSTHEME — Digital Product Commerce Platform

Hệ thống thương mại số phân phối Theme, Plugin, Figma UI Kit, License phần mềm và Cloud Hosting,
kèm CMS/SEO, tự động hoá n8n, affiliate & membership, hosting, helpdesk, sổ cái kế toán và
(Phase 19) **nền tảng AI Marketing OS + kho dữ liệu marketing**.

Kiến trúc: **3 Frontend (Next.js) + 1 API (NestJS modular monolith) + Worker + PostgreSQL/Redis/S3 + n8n**.
Nguyên tắc cốt lõi, lịch sử từng phase và quy tắc review nằm trong [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

---

## 1. Trạng thái các phase

| Phase | Nội dung | Acceptance |
|---|---|---|
| 1–3 | Foundation, Identity & RBAC (Supabase), Catalog & Admin product | — |
| 4–9 | Commerce core, Entitlement engine, Elementor external license, Internal license, Download & version, Stripe production payment | `test:acceptance:phase4` … `phase9` |
| 10–12 | Customer portal, CMS & SEO, n8n automation & AI drafts | `phase10` … `phase12` |
| 13–16 | Affiliate & membership, Hosting provisioning, Helpdesk & notifications, Ledger & invoicing | `phase13` … `phase16` |
| 17–18 | Production storefront & design system, Hardening / observability / DR | `phase17`, `phase18` |
| **19** | **AI Marketing OS & Analytics foundation** (tenants, analytics warehouse, ingestion, AI skills/context/workflows, Superset boundary) | `phase19` |

Chi tiết Phase 19: [`docs/architecture/phase-19-ai-marketing-os.md`](docs/architecture/phase-19-ai-marketing-os.md),
Superset MCP: [`docs/architecture/superset-mcp.md`](docs/architecture/superset-mcp.md),
AI content: [`ai/README.md`](ai/README.md), Superset: [`infra/superset/README.md`](infra/superset/README.md).

---

## 2. Yêu cầu môi trường

- **Node.js** `>= 22.13` (pnpm 11 yêu cầu; khuyến nghị 24.x). CI dùng Node 22.
- **pnpm** `11.20.0` (khai báo trong `packageManager`).
- **Docker Desktop** với Docker Compose v2+.

## 3. Port map

| Dịch vụ | Địa chỉ | Công nghệ | Mục đích |
|:---|:---|:---|:---|
| Public Web | `http://localhost:3000` | Next.js 14 | Marketplace, catalog, blog, checkout |
| Customer Portal | `http://localhost:3001` | Next.js 14 | Đơn hàng, license, tải xuống, hosting, ticket, **phân tích marketing** |
| Super Admin | `http://localhost:3002` | Next.js 14 | Catalog, CMS, automation, **analytics, AI** |
| Backend API | `http://localhost:4000` | NestJS | Toàn bộ nghiệp vụ, nguồn quyết định trạng thái duy nhất |
| PostgreSQL | `localhost:5432` | PostgreSQL 16 | Schema `public` (nghiệp vụ) + `analytics` (kho marketing) |
| Redis | `localhost:6379` | Redis 7 | Cache, lock, BullMQ, chống replay |
| MinIO | `http://localhost:9000` / `9001` | S3 API / console | Giả lập Cloudflare R2 |
| n8n (tuỳ chọn) | `http://localhost:5678` | n8n | Điều phối, không ghi DB trực tiếp |
| Superset (tuỳ chọn) | `http://127.0.0.1:8088` | Apache Superset | BI chỉ đọc schema `analytics` |

## 4. Chạy local

```bash
cp .env.example .env                 # điền LICENSE_KEY_ENCRYPTION_KEY, AUTOMATION_SERVICE_SECRET (>= 32 ký tự)...
docker compose up -d                 # postgres, redis, minio (+ bucket marketplace-dev)
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed:system                  # RBAC (8 role, 42 permission) + SYSTEM AI context; an toàn cho production
SEED_DEV_USERS=true pnpm db:seed:dev # user dev (bị chặn ở production)
pnpm db:seed:catalog                 # catalog mẫu
# hoặc gộp cho local: pnpm db:seed:local
pnpm dev
```

Windows PowerShell: `$env:SEED_DEV_USERS="true"; pnpm db:seed:dev`.

Superset (tuỳ chọn): xem [`infra/superset/README.md`](infra/superset/README.md).

## 5. Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test                       # unit test toàn monorepo
pnpm build
pnpm worker:smoke
pnpm test:acceptance:phase4     # ... đến phase19 (cần Postgres + Redis + MinIO, API build sẵn)
pnpm test:acceptance:phase19
pnpm n8n:validate
pnpm analytics:superset-metrics # sinh lại định nghĩa metric cho Superset từ registry
```

CI: `.github/workflows/phase19-ci.yml` chạy toàn bộ chuỗi trên cho mọi PR vào `main`.

## 6. Health check

- `GET /health` — tổng hợp Database, Redis, Storage.
- `GET /health/liveness`, `GET /health/readiness`, `GET /health/metrics` (Phase 18).
- `GET /health/db`, `/health/redis`, `/health/storage`.

## 7. Phase 19 tóm tắt

- **Tenancy**: `tenants` (ORGANIZATION → CLIENT) + `tenant_members` (VIEWER / ANALYST / MANAGER).
  Mọi truy vấn analytics/AI lọc theo tenant ở backend; tenant khác trả 404.
- **Kho dữ liệu**: schema `analytics` (`dim_*`, `fact_*`, `raw_ingest_batches`). Chỉ số dẫn xuất
  (CTR, CPC, CPL, CPQL, CAC, ROAS, CVR) tính từ một registry duy nhất `packages/utils/src/analytics-metrics.ts`.
- **Ingestion**: `POST /internal/analytics/ingest`, ký HMAC (`AUTOMATION_SERVICE_SECRET`), chống replay,
  idempotency `(source, idempotencyKey)`, giới hạn kích thước, từ chối KPI do client tự tính.
- **AI**: `packages/ai-core` + `ai/skills` (4 skill), context có phiên bản (append-only),
  workflow `weekly-marketing-review`, audit từng bước, công cụ phân loại rủi ro, hành động rủi ro cao cần
  người khác duyệt. Mặc định không gọi model (`AI_PROVIDER=none`).
- **Superset**: dịch vụ ngoài, role DB `superset_ro` chỉ đọc `analytics`, metadata DB riêng. MCP mới ở mức thiết kế.

## 8. Lịch sử

Phase 1 (Foundation) ban đầu chỉ gồm landing tối giản, `DevMockAuthProvider`, chưa có payment hay n8n.
Các giới hạn đó đã được giải quyết ở Phase 2–18; nhật ký đầy đủ nằm trong `PROJECT_CONTEXT.md`.
