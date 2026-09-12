# PROJECT CONTEXT — Digital Product Commerce Platform

Repo chính: `pgswork8686-stack/D-n-i-p-12-9`

## Vai trò
- Codex: code, test, push branch/PR.
- ChatGPT: reviewer/architect; rà kiến trúc, business logic, security, test, consistency, đối chiếu spec.
- Ưu tiên branch + Pull Request, hạn chế push feature trực tiếp vào `main`.

## Kiến trúc chốt
```text
Cloudflare
  ├─ www.domain.com   → Next.js Marketplace/SEO
  ├─ app.domain.com   → Next.js Customer Portal
  └─ admin.domain.com → Next.js Admin/CMS
               ↓
          api.domain.com
              NestJS
               ↓
   PostgreSQL + Redis/BullMQ + Cloudflare R2
               ↓
        Worker + n8n + External APIs
```

Nguyên tắc:
1. Backend là nguồn quyết định business state duy nhất.
2. Frontend không tự đổi order/payment/license state.
3. n8n không ghi trực tiếp business-critical data vào DB; chỉ orchestration.
4. Payment success page không được tự đổi order sang `PAID`; chỉ verified signed webhook.
5. PostgreSQL là source of truth.
6. V1 dùng NestJS Modular Monolith, chưa microservice hóa sớm.
7. File ZIP private chỉ tải qua entitlement check + signed URL ngắn hạn.

## Stack V1
- Monorepo: pnpm + Turborepo
- Web/Portal/Admin: Next.js
- API: NestJS
- DB: PostgreSQL + Prisma
- Auth: Supabase Auth
- Queue/cache: Redis + BullMQ
- Storage: Cloudflare R2
- Automation: n8n
- Deploy: Docker + Coolify
- CDN/WAF: Cloudflare
- API docs: OpenAPI

## Cấu trúc monorepo mục tiêu
```text
apps/
  web/
  portal/
  admin/
  api/
  worker/
packages/
  ui/
  database/
  contracts/
  sdk/
  auth/
  config/
  utils/
automation/n8n/
infra/docker/
infra/coolify/
```

## Product Engine
Product types ban đầu:
- DOWNLOADABLE_ASSET
- LICENSED_SOFTWARE
- EXTERNAL_MANAGED_LICENSE
- MEMBERSHIP
- SUBSCRIPTION
- SERVICE

Fulfillment strategies:
- DIGITAL_DOWNLOAD
- INTERNAL_LICENSE
- EXTERNAL_MANAGED
- MEMBERSHIP_ACCESS
- EXTERNAL_PROVISIONING
- MANUAL_SERVICE

Ví dụ:
- Theme/plugin tự quản → INTERNAL_LICENSE
- Figma/UI Kit → DIGITAL_DOWNLOAD
- Elementor → EXTERNAL_MANAGED

## Entitlement là lõi
Không thiết kế `order → license`.

Phải là:
```text
order → order_item → entitlement → fulfillment strategy
```

Entitlement trả lời: khách có quyền dùng gì, bao lâu, bao nhiêu site, được update/support/download tới khi nào. License key chỉ là một loại fulfillment.

## Elementor / external managed license
Không coi mỗi khách là một Elementor key riêng. Hệ thống quản quyền khách bằng entitlement + allocation trên một provider account/upstream subscription.

```text
Elementor Provider Account
  ├─ allocation → customer A → a.com
  ├─ allocation → customer B → b.com
  └─ available capacity
```

Customer Portal không hiển thị master account/key/token.

V1 nếu chưa có official provider API phù hợp:
`fulfillment_mode = MANUAL_EXTERNAL`

Flow:
```text
Order PAID
→ Entitlement ACTIVE
→ Customer nhập domain
→ Allocation PENDING
→ Admin xử lý upstream
→ Admin Confirm
→ Allocation ACTIVE
```

Không reverse-engineer/private API hoặc bot login nếu không có cơ chế chính thức phù hợp.

## Bảng lõi
Identity:
`users, profiles, roles, permissions, user_roles, role_permissions`

Catalog:
`products, product_variants, product_prices, categories, product_categories, product_versions, product_version_files, product_media, license_plans`

Commerce:
`carts, cart_items, orders, order_items, payments, payment_transactions, payment_webhook_events, coupons, refunds, subscriptions`

Access/Fulfillment:
`entitlements, licenses, license_activations, license_providers, provider_accounts, license_allocations, download_grants, download_events`

Content:
`posts, post_revisions, seo_documents, media_assets, content_jobs, content_job_runs`

Operations:
`tickets, ticket_messages, notifications, outbox_events, automation_runs, audit_logs, idempotency_keys, system_settings`

## Payment flow
```text
Customer
→ Cart
→ backend recalculates price
→ Order PENDING_PAYMENT
→ Payment provider
→ SIGNED WEBHOOK
→ verify signature
→ idempotency check
→ DB transaction:
   Payment SUCCEEDED
   Order PAID
   create Entitlement
   create Outbox Event
```

Side-effects như email, license generation, affiliate commission chạy qua outbox/worker.

## License nội bộ
Dự kiến:
- POST /v1/licenses/activate
- POST /v1/licenses/deactivate
- POST /v1/licenses/validate
- GET /v1/account/licenses

Domain phải normalize trước khi so sánh; activation limit kiểm tra ở backend.

## Download Engine
```text
Customer click Download
→ POST /v1/downloads/request
→ check auth
→ check entitlement
→ check version permission
→ check rate limit
→ signed R2 URL TTL 2–5 phút
→ log download event
```

Không render permanent private ZIP URL.

## CMS riêng
Không phụ thuộc WordPress.

Post states:
`IDEA → DRAFT → AI_DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED`

Hỗ trợ: title, slug, excerpt, block/rich content, featured image, category/tags, author, SEO title, meta description, canonical, OG, schema JSON, schedule, revision history.

Public web dùng Next.js SSR/ISR.

## n8n / AI Automation
V1 ưu tiên AI tạo draft.

```text
Keyword/topic
→ content_job
→ queue
→ n8n/AI
→ outline + draft + SEO + internal links
→ POST internal API
→ AI_DRAFT
→ QA
→ REVIEW
→ Human approve
→ SCHEDULED/PUBLISHED
```

n8n không insert/update trực tiếp `posts` trong DB.

## UI Stitch
Khoảng 32 screens. Không copy/paste 32 HTML file vào production.

Rebuild thành shared components: Header, Footer, MegaMenu, ProductCard, ProductGrid, Button, Input, Select, Modal, Drawer, Toast, Badge, Tabs, Breadcrumb, Pagination, DataTable, EmptyState, ErrorState, Skeleton.

Portal components: PortalShell, Sidebar, Topbar, StatCard, OrderTable, DownloadCard, LicenseCard, ActivationTable, InvoiceTable, TicketThread.

Màn hình cần bổ sung: Product Detail, Customer Dashboard, Standard Checkout, Order Detail, Account Security/2FA, Notification Center, 403/404/500, Empty/Loading/Error states, Admin UI.

## V1 scope
Ưu tiên: Themes, Plugins, Figma/UI Kits, External managed licenses, Catalog, Checkout, Payment, Entitlement, License/Download, Customer Portal, CMS/SEO, Automation.

Chưa ưu tiên: multi-vendor, hosting control plane tự xây, marketplace AI/software account quá rộng, mobile app, Zalo mini app.

## Thứ tự triển khai
1. Foundation: monorepo, Docker, env/staging, PostgreSQL, Redis, R2, Auth, health checks.
2. Catalog/Admin: Product, Variant, Price, Product type, Fulfillment strategy, Admin CRUD.
3. Commerce slice: Cart, Checkout, Order, test payment, Entitlement.
4. Elementor flow: Product → fake buy → PAID → Entitlement → domain → Allocation PENDING → Admin Confirm → ACTIVE.
5. Internal License + Download.
6. Payment production: provider abstraction, signed webhook, idempotency, refund/revoke.
7. Customer Portal.
8. CMS + SEO.
9. n8n Automation.
10. Growth: affiliate, membership, hosting integration, advanced search.

## Security baseline
- HTTPS, Cloudflare WAF, RBAC, MFA cho admin
- Rate limiting
- Signed webhooks + idempotency
- CSRF nếu cookie auth
- Refresh token rotation
- Secrets không commit Git
- DB private
- R2 signed URL
- Upload validation
- Audit logs
- Backup + restore test
- Không log password/access token/provider secret/payment secret

## Review rubric
```text
STATUS: PASS / NEED FIX / BLOCKER

BLOCKER: sai kiến trúc, mất dữ liệu, lỗ hổng nghiêm trọng
HIGH: business logic/security/test quan trọng
MEDIUM: consistency/maintainability/DX
LOW: cleanup/cosmetic
```

Checklist review:
1. Đúng domain boundary?
2. Business logic nằm backend?
3. Có bypass entitlement/payment/auth?
4. Webhook/idempotency an toàn?
5. Frontend/n8n có ghi DB trực tiếp?
6. Có public secret/private URL?
7. Có test happy path + failure path?
8. Migration an toàn?
9. Error handling/logging đủ?
10. Bám đúng PROJECT_CONTEXT.md?

## Milestone đầu tiên
Không ưu tiên homepage.

Milestone 01: **foundation + product/admin + một vertical slice Elementor chạy end-to-end trên test data**.

Chỉ mở rộng sau khi milestone này PASS review.
