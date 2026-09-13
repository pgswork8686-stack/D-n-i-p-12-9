# PROJECT CONTEXT — Digital Product Commerce Platform

Repo chính: `pgswork8686-stack/D-n-i-p-12-9`

## Governance / nguồn chuẩn
File này là **hiến pháp kiến trúc/domain** của dự án.

Thứ tự triển khai hiện hành không được suy ra từ các PR cũ hoặc các đoạn roadmap lịch sử. Luôn dùng:
1. `AGENTS.md` — luật làm việc cho agent
2. `PROJECT_CONTEXT.md` — kiến trúc/domain bất biến
3. `ROADMAP.md` — thứ tự phase hiện hành
4. `CURRENT_PHASE.md` — phase/scope được phép làm ngay bây giờ
5. `docs/phases/<current-phase>.md` — implementation/acceptance contract
6. `DECISIONS.md` — quyết định kiến trúc/business bền vững

Nếu file này và `ROADMAP.md` khác nhau về **thứ tự phase**, `ROADMAP.md` + `CURRENT_PHASE.md` là nguồn quyết định hiện hành. Nếu khác nhau về **kiến trúc/domain bất biến**, không tự đoán; phải resolve decision trước khi code tiếp.

## Vai trò
- Codex / Antigravity: code, test, push branch/PR theo phase spec.
- ChatGPT: reviewer/architect; rà kiến trúc, business logic, security, test, concurrency, migration, consistency, đối chiếu spec.
- Ưu tiên branch + Pull Request, không push feature trực tiếp vào `main`.
- Implementation agent không tự merge phase PR; chỉ merge sau independent review/PASS.

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
2. Frontend không tự đổi order/payment/entitlement/license/allocation state.
3. n8n không ghi trực tiếp business-critical data vào DB; chỉ orchestration.
4. Payment success page không được tự đổi order sang `PAID`; chỉ verified signed provider event.
5. PostgreSQL là source of truth.
6. V1 dùng NestJS Modular Monolith, chưa microservice hóa sớm.
7. File/package private chỉ tải qua entitlement check + signed URL ngắn hạn.
8. Paid access đi qua Entitlement; không thiết kế shortcut `order → license`.
9. Preview runtime và distributable package là hai security domain riêng.

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

Purchased entitlement terms phải dựa vào immutable purchase/order-item snapshot, không được âm thầm thay đổi theo catalog hiện tại.

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

## Payment flow — target end state
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
   create Outbox Event
→ Worker consumes ORDER_PAID
→ create/reconcile Entitlement idempotently
→ downstream fulfillment
```

Phased implementation rule:
- Phase 4 dừng ở Payment/Order + `ORDER_PAID` transactional outbox.
- Phase 5 mới triển khai Entitlement creation/reconciliation.
- Không kéo Entitlement vào Commerce chỉ để “hoàn thành flow sớm”.

Side-effects như email, entitlement handoff, license generation, affiliate commission chạy qua outbox/worker phù hợp với từng phase.

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
→ signed R2 URL TTL ngắn
→ log download event
```

Không render permanent private ZIP URL.

## Preview Engine
Mục tiêu: ThemeForest-style `Live Preview` nhưng preview không được trở thành đường dẫn lấy distributable source/package.

Flow kiến trúc:
```text
Product Detail
→ Live Preview
→ Preview Session
→ signed short-lived token
→ Preview Gateway
→ private/sanitized demo runtime
```

Hai policy mode dự kiến:
- `STANDARD`: gateway + isolated demo runtime + WAF/rate limit/noindex/no source maps.
- `PROTECTED`: remote browser/render streaming cho asset giá trị cao; client chủ yếu nhận rendered output thay vì demo DOM/CSS/JS gốc.

Không hứa “anti-clone 100%”: pixel đã hiển thị vẫn có thể screenshot/AI recreate. Mục tiêu bảo mật là bảo vệ package/source/secret, chặn bypass trực tiếp và tăng chi phí automated scraping.

Chi tiết: `docs/architecture/preview-engine.md`.

## CMS riêng
Không phụ thuộc WordPress.

Post states:
`IDEA → DRAFT → AI_DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED`

Hỗ trợ: title, slug, excerpt, block/rich content, featured image, category/tags, author, SEO title, meta description, canonical, OG, schema JSON, schedule, revision history.

Public web dùng Next.js SSR/ISR.

CMS/SEO không nằm trên critical path của vertical slice commerce đầu tiên; triển khai theo `ROADMAP.md`.

## n8n / AI Automation
V1 hướng tới AI tạo draft, nhưng chỉ sau các commerce/fulfillment vertical slice ưu tiên trong `ROADMAP.md`.

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

n8n không insert/update trực tiếp business-critical DB tables; content automation cũng đi qua internal API/service boundary phù hợp.

## UI Stitch
Khoảng 32 screens. Không copy/paste 32 HTML file vào production.

Rebuild thành shared components: Header, Footer, MegaMenu, ProductCard, ProductGrid, Button, Input, Select, Modal, Drawer, Toast, Badge, Tabs, Breadcrumb, Pagination, DataTable, EmptyState, ErrorState, Skeleton.

Portal components: PortalShell, Sidebar, Topbar, StatCard, OrderTable, DownloadCard, LicenseCard, ActivationTable, InvoiceTable, TicketThread.

Màn hình cần bổ sung: Product Detail, Customer Dashboard, Standard Checkout, Order Detail, Account Security/2FA, Notification Center, 403/404/500, Empty/Loading/Error states, Admin UI.

Không cần hoàn thiện toàn bộ 32 screens trước khi vertical slice đầu tiên chạy end-to-end.

## V1 scope
Ưu tiên kiến trúc hỗ trợ: Themes, Plugins, Figma/UI Kits, External managed licenses, Catalog, Checkout, Payment, Entitlement, License/Download, Customer Portal, CMS/SEO, Automation.

Launch scope thực tế được thu hẹp theo `ROADMAP.md`: chứng minh từng vertical slice trước, không launch mọi product type cùng lúc.

Chưa ưu tiên: multi-vendor, hosting control plane tự xây, marketplace AI/software account quá rộng, mobile app, Zalo mini app, Kubernetes/microservices/multi-region.

## Thứ tự triển khai
**Nguồn chuẩn duy nhất cho thứ tự phase hiện hành: `ROADMAP.md`.**

Tại thời điểm cập nhật governance:
- DONE: Phase 1 Foundation, Phase 2 Identity/RBAC, Phase 3 Catalog/Admin.
- CURRENT: Phase 4 Commerce Core.
- NEXT: Phase 5 Entitlement Engine → Digital Download vertical slice → staging foundation → first production payment → external managed license → internal license → portal completion → preview engine.

Không sửa thứ tự triển khai ở file này mà quên `ROADMAP.md`/`CURRENT_PHASE.md`.

## Security baseline
- HTTPS, Cloudflare WAF, RBAC, MFA cho admin
- Rate limiting
- Signed webhooks + idempotency
- CSRF nếu cookie auth
- Refresh token rotation
- Secrets không commit Git
- DB private
- R2/private storage signed URL ngắn hạn
- Upload validation
- Audit logs
- Backup + restore test
- Không log password/access token/provider secret/payment secret/private signed URL token
- Preview runtime không chứa provider master credential hoặc distributable package secret

## Review rubric
```text
STATUS: PASS / NEED FIX / BLOCKER

BLOCKER: sai kiến trúc, mất dữ liệu, lỗ hổng nghiêm trọng
HIGH: business logic/security/concurrency/test quan trọng
MEDIUM: consistency/maintainability/DX
LOW: cleanup/cosmetic
```

Checklist review:
1. Đúng domain boundary?
2. Business logic nằm backend?
3. Có bypass entitlement/payment/auth?
4. Webhook/idempotency/concurrency an toàn?
5. Frontend/n8n có ghi business-critical DB trực tiếp?
6. Có public secret/private URL/provider credential?
7. Có test happy path + failure path + ownership + race nếu cần?
8. Migration an toàn?
9. Error handling/logging đủ và không leak secret?
10. Bám `AGENTS.md`, `CURRENT_PHASE.md`, phase spec và `DECISIONS.md`?

## Milestone sản phẩm đầu tiên
Không ưu tiên homepage/CMS hoàn chỉnh.

Milestone phải chứng minh một lifecycle thật:
```text
browse
→ cart
→ checkout
→ payment
→ order paid
→ entitlement
→ fulfillment
→ logout/login lại
→ quyền truy cập vẫn đúng
```

Vertical slice đầu ưu tiên: **DIGITAL_DOWNLOAD** vì đây là cách ngắn nhất để chứng minh commerce + entitlement + delivery hoàn chỉnh. External managed license/Elementor là vertical slice tiếp theo theo `ROADMAP.md`.

Chỉ mở rộng mạnh sang CMS/AI/affiliate/growth sau khi các vertical slice cốt lõi PASS review.
