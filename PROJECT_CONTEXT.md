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
order → order_item (immutable purchase snapshot) → entitlement (typed rights) → fulfillment strategy
```

Entitlement trả lời: khách có quyền dùng gì, bao lâu, bao nhiêu site (`maxActivations`), được update (`updatesUntil`) / support (`supportUntil`) / download tới khi nào. License key chỉ là một loại fulfillment.

Fulfillment cụ thể được chia theo từng phase độc lập:
- Phase 6: Elementor External Managed License (upstream allocation, domain binding)
- Phase 7: Internal License (activation, deactivation, validation)
- Phase 8: Download & Version (asset release versions, signed short-lived R2 URLs)

### Legacy Order Policy
- Các đơn hàng cũ hoặc OrderItem không có `snapshotVersion` (null/0) sẽ fail-closed: **KHÔNG tự suy diễn quyền từ catalog hiện tại**.
- Không tự ý backfill bằng mutable `LicensePlan`.
- Quy trình vận hành: Nếu có dữ liệu đơn hàng trả phí trước Phase 5 cần cấp quyền, phải thực hiện explicit manual reconciliation / deterministic backfill script trước khi cutover sang production.

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

## Payment & Entitlement Flow
```text
Customer
→ Cart
→ backend recalculates price & bounds
→ Order PENDING_PAYMENT + immutable OrderItem snapshots (snapshotVersion=1, licensePlanIdAtPurchase, isLifetime, durationDays, durationMonths, maxActivations, updatesDays, supportDays)
→ Payment provider
→ SIGNED WEBHOOK
→ verify signature
→ idempotency check
→ DB transaction (Phase 4):
   Payment SUCCEEDED
   Order PAID
   create Outbox Event (ORDER_PAID)

→ Worker Outbox Consumer (Phase 5):
   first-party worker consumes ORDER_PAID event (FOR UPDATE SKIP LOCKED)
   → idempotent entitlement issuance
   → one Entitlement per OrderItem (ON CONFLICT ("order_item_id") DO NOTHING)
   → immutable purchased-right snapshot (ZERO mutable catalog fallback)
   → typed rights: maxActivations, updatesUntil, supportUntil
   → Outbox Event PROCESSED
```

Side-effects như email, license generation, affiliate commission chạy qua outbox/worker.

## License nội bộ (Phase 7 Implemented)
Kiến trúc Internal License Engine:
- Mã bản quyền chuẩn định dạng `NXS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (128-bit cryptographic entropy).
- Khóa lưu trữ an toàn: Plaintext key được tra cứu lặp lại an toàn bởi khách hàng sở hữu qua xác thực quyền sở hữu tại `POST /licenses/:id/reveal`. Database chỉ lưu ciphertext mã hóa bằng AES-256-GCM (`encryptedKey`, IV, auth tag) và `keyHash` (SHA-256) cho tra cứu nhanh không khả nghịch. Khóa plaintext tuyệt đối KHÔNG bao giờ xuất hiện trong audit logs hay error payloads.
- Endpoints:
  - `POST /v1/licenses/activate`: Kích hoạt domain, kiểm tra sức chứa `maxActivations`, chuẩn hóa canonical domain (loại bỏ protocol, trailing slash, port, query params), idempotent cho cùng domain. Chống race condition kích hoạt đồng thời vượt quá số ghế.
  - `POST /v1/licenses/validate`: Thẩm định trạng thái license và domain theo thời gian thực. Chống vét cạn (anti-enumeration): mọi trạng thái không hợp lệ (key sai, domain sai, entitlement hết hạn/bị thu hồi) đều trả về `{ valid: false }` với HTTP 200 không tiết lộ nguyên nhân.
  - `POST /v1/licenses/deactivate`: Hủy kích hoạt domain, giải phóng ghế cho domain mới. CAS nguyên tử, idempotent.
  - `GET /licenses`: Khách hàng tra cứu danh sách license thuộc sở hữu với masked key (`NXS-****-...-XXXX`).
  - `POST /licenses/:id/reveal`: Khách hàng giải mã và xem plaintext key của license họ sở hữu (yêu cầu AuthGuard và quyền sở hữu).
  - Admin management: `GET /admin/internal-licenses`, `POST /admin/internal-licenses/:id/revoke` (bảo vệ chống license key injection vào audit log).
- Worker tự động hóa:
  - Worker nền tự động phát hiện `Entitlement` loại `INTERNAL_LICENSE` ở trạng thái `ACTIVE` để tạo `InternalLicense` tự động, idempotent, an toàn khi nhiều worker chạy song song.
  - Worker định kỳ đối soát thu hồi giấy phép (`reconcileInternalLicenses`) khi Entitlement tương ứng bị `REVOKED` hoặc `EXPIRED`.

## Download & Version Engine (Phase 8 Implemented)
Kiến trúc quản lý phiên bản phần mềm & cấp quyền tải an toàn:
- Quản lý phiên bản chuẩn SemVer 2.0.0 (`major.minor.patch[-prerelease][+build]`): Thẩm định định dạng, chuẩn hóa, phân tách metadata, so sánh và sắp xếp phiên bản chính xác qua `@nexus/utils/semver`.
- Mô hình dữ liệu & File chính (Primary Package):
  - Bảng `ProductVersionFile`: Trường `isPrimary Boolean @default(false)` kèm partial unique index PostgreSQL `CREATE UNIQUE INDEX "product_version_files_version_primary_unique" ON "product_version_files"("product_version_id") WHERE is_primary = true;`. Đối với sản phẩm `INTERNAL_LICENSE`, phiên bản bắt buộc phải có đúng 1 file chính đã được xác thực trước khi chuyển trạng thái `PUBLISHED`.
  - Bảng `DownloadGrant`: Bản ghi cấp quyền tải chuẩn nghiệp vụ lưu vết `userId`, `entitlementId`, `licenseId`, `productVersionId`, `fileId`, `channel`, `ipAddress`, `expiresAt`. Được ghi nhận nguyên tử trong giao dịch PostgreSQL cùng với `DownloadEvent` và `AuditLog`, bảo đảm tính tuyến tính (`SELECT ... FOR UPDATE` trên `entitlements` và `internal_licenses`), ngăn chặn triệt để race condition giữa việc thu hồi Entitlement / License và việc cấp URL tải (`grant.issuedAt <= entitlement.revokedAt`).
- Object Storage riêng tư: MinIO (local development) / Cloudflare R2 (production) qua S3-compatible abstraction.
  - Tuyệt đối KHÔNG có URL công khai hoặc URL vĩnh viễn cho tài sản số.
  - Quyền sở hữu file lưu trữ thuộc về backend: Admin upload file trực tiếp qua API multipart (`POST /admin/product-versions/:id/files/upload`) với giới hạn dung lượng nghiêm ngặt (Multer limit + server-side check, trả về HTTP 413 khi vượt ngưỡng), backend tự sinh `storageKey` (`products/{productId}/versions/{versionId}/{uuid}-{filename}`), tính toán SHA-256 và sizeBytes, upload lên bucket và xác thực tự động. Không cho phép client chỉ định `storageKey` tùy ý. Đã loại bỏ hoàn toàn endpoint JSON đăng ký file và `AddVersionFileRequest`.
  - Tự động dọn dẹp file mồ côi (Orphan Cleanup): Nếu xác thực integrity sau upload hoặc lưu trữ bản ghi cơ sở dữ liệu gặp lỗi (e.g. HTTP 409 xung đột primary package), backend lập tức kích hoạt dọn dẹp best-effort xóa object vừa upload khỏi bucket riêng tư qua `storageService.deleteObject(storageKey)`.
  - Chữ ký tải file (Signed URLs) là tạm thời với TTL được kẹp chặt từ 120s–300s (mặc định 180s) qua hàm `resolveDownloadTtl(configuredTtl)`.
  - Header tải xuống an toàn: `Content-Disposition: attachment; filename="safe-filename.zip"` chuẩn RFC 6266.
  - Fail-closed khi khởi động môi trường production nếu thiếu bất kỳ biến cấu hình Storage nào (`STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`).
- Toàn vẹn dữ liệu:
  - Xác thực streaming SHA-256 checksum và kích thước `sizeBytes` đối chiếu trực tiếp với storage trước khi file được chuyển sang trạng thái `VERIFIED`.
  - Bắt buộc tái xác thực toàn vẹn trước khi phát hành (Mandatory pre-publish reverification): Hàm nghiệp vụ `publishProductVersion` bắt buộc phải có callback `verifyFileIntegrity` (nếu thiếu hoặc không phải hàm, lập tức fail-closed trả về HTTP 503 `STORAGE_VERIFICATION_REQUIRED`, giữ nguyên trạng thái `DRAFT` và không ghi nhận audit log). Quy trình phát hành 2 pha an toàn: Pha 1 đọc và thẩm định toàn vẹn file với storage bên ngoài giao dịch DB; Pha 2 khóa hàng `SELECT ... FOR UPDATE`, kiểm tra drift so với snapshot đã thẩm định, thực hiện CAS nguyên tử `DRAFT -> PUBLISHED` và ghi nhận đúng 1 audit log `VERSION_PUBLISHED`.
  - Bất biến (Immutability): Phiên bản và file đã `PUBLISHED` là bất biến. Mọi thao tác cập nhật/xóa sau khi phát hành đều bị chặn (HTTP 409).
- Quy trình cấp quyền tải tuyến tính 3 bước (Linearized 3-Step Issuance):
  - Bước A: Cấp `DownloadGrant` trong giao dịch khóa hàng (`SELECT ... FOR UPDATE` trên `entitlements` / `internal_licenses`) làm linearization point.
  - Bước B: Kiểm tra sự tồn tại của file trên storage (`headObject`) và tạo signed URL. Nếu storage object bị xóa hoặc thiếu, lập tức fail-closed (HTTP 503 cho khách hàng, `updateAvailable: false` cho updater), tuyệt đối KHÔNG phát sinh `DownloadEvent` hay audit log `DOWNLOAD_URL_ISSUED`.
  - Bước C: Gọi `recordDownloadIssuance` ghi nhận nguyên tử `DownloadEvent` và audit log `DOWNLOAD_URL_ISSUED` liên kết với grant chỉ sau khi URL đã được tạo thành công.
- Kênh tải khách hàng (`POST /v1/downloads/request`, channel `CUSTOMER_PORTAL`):
  - Preflight validation: Thẩm định quyền sở hữu Entitlement trước khi chạm Redis để chống spam key rate limit rác.
  - Kiểm tra xác thực (AuthGuard), quyền sở hữu Entitlement, trạng thái `ACTIVE` và chưa hết hạn `expiresAt`. Hỗ trợ cả `DIGITAL_DOWNLOAD` và `INTERNAL_LICENSE`.
  - Kiểm tra cửa sổ cập nhật: `releasedAt <= updatesUntil`. Nếu `updatesUntil === null`, khách hàng được tải mọi bản phát hành mới nhất khi Entitlement còn hoạt động. Nếu hết hạn cập nhật (`updatesUntil < now`), khách hàng vẫn giữ quyền tải vĩnh viễn các phiên bản được phát hành trong thời gian bản quyền còn hiệu lực (`releasedAt <= updatesUntil`).
- Kênh cập nhật tự động / WordPress Updater (`POST /v1/updates/check`, channel `LICENSE_UPDATER`):
  - Preflight validation: Kiểm tra license `ACTIVE` và có activation `ACTIVE` trên đúng `normalizedDomain` trước khi chạm Redis rate limiter.
  - Phân giải gói chính bắt buộc (Deterministic primary package resolution): Chỉ chấp nhận file có `isPrimary: true` và đã `verifiedAt`. Nếu phiên bản không có primary file, fail-closed trả về `{ valid: true, updateAvailable: false }`, không cấp quyền và không tạo URL cho file phụ. Khi có bản cập nhật mới, endpoint trả về trực tiếp signed `downloadUrl` và metadata phiên bản mới.
  - Khóa hàng hai tầng (`internal_licenses FOR UPDATE` -> `entitlements FOR UPDATE`) ngăn ngừa race condition thu hồi.
  - Chống vét cạn: license không hợp lệ hoặc không có quyền trả về payload rỗng `{ valid: false, updateAvailable: false }` thay vì lộ thông tin nội bộ.
- Giới hạn tần suất tải (Atomic Sliding Window Rate Limiting):
  - Redis ZSET sliding-window Lua script nguyên tử: Tối đa 10 lượt tải trong cửa sổ trượt 600 giây trên mỗi Entitlement (kênh khách hàng) hoặc mỗi Entitlement + Domain (kênh updater).
  - Quyền sở hữu thời gian thuộc về Redis: Lua script trực tiếp đọc thời gian nguyên tử từ Redis qua `redis.call('TIME')`, thành viên ZSET có cấu trúc `${nowMs}:${nonce}` (với nonce là UUID ngẫu nhiên), loại bỏ hoàn toàn nguy cơ sai lệch đồng hồ giữa các node ứng dụng.
  - Nguyên tắc Fail-closed: Nếu Redis gặp sự cố, hệ thống trả về HTTP 503 (Service Unavailable), không mở cổng tải không giới hạn và không ghi nhận DownloadGrant/Event rác.
- Bảo mật thông tin:
  - Signed URLs và tham số chữ ký lưu trữ (`X-Amz-Signature`, `X-Amz-Credential`, v.v.) tuyệt đối KHÔNG bao giờ được ghi vào database, bảng `DownloadEvent`, `DownloadGrant`, hay `AuditLog`.

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

## Thứ tự triển khai (Roadmap 15 Phases)
1. Phase 1 — Foundation (Local setup, Docker, Turbo, NestJS, Next.js, Redis, MinIO)
2. Phase 2 — Identity, Authentication & RBAC (Supabase Auth, RBAC authority, Audit)
3. Phase 3 — Catalog & Admin Product (Extensible multi-model product engine, categories, minor-unit money)
4. Phase 4 — Commerce Core (Cart, Checkout, Order, Outbox pattern, idempotent payment callbacks)
5. Phase 5 — Entitlement Engine (Immutable purchased rights snapshot, worker-driven issuance, expiration engine, typed rights)
6. Phase 6 — Elementor External License (Upstream capacity, customer domain allocation, lifecycle management)
7. Phase 7 — Internal License (Offline activation, cryptographically verifiable tokens, domain limits)
8. Phase 8 — Download & Version (Private asset versioning, signed R2 download tokens, rate limits)
9. Phase 9 — Production Payment (Stripe Checkout sessions, signed webhooks, fail-closed binding, atomic outbox, reconciler, raw_payload_hash)
10. Phase 10 — Customer Portal (License center, download hub, domain binding GUI)
11. Phase 11 — CMS & SEO (Editorial content, programmatic SEO, dynamic metadata)
12. Phase 12 — n8n Automation (AI-assisted drafts, operational notifications)
13. Phase 13 — Affiliate & Membership (Tiered access, recurring entitlements, referral tracking)
14. Phase 14 — Hosting Integration (cPanel/DirectAdmin/Cloudflare automation)
15. Phase 15 — Hardening & Production (Penetration testing, rate limiting, disaster recovery)

## Phase 9 — Production Payment Gateway Architecture
- **Official Provider**: Stripe Checkout Session (`cs_...`) and signed webhook events.
- **Option 1 Event Model**: Only `checkout.session.completed` with `payment_status === "paid"` triggers `SUCCEEDED`. All `payment_intent.*` events are **strictly ignored** at the webhook layer. `checkout.session.async_payment_failed` → `FAILED`. `checkout.session.expired` → `CANCELLED`.
- **Provider-Neutral Abstraction**: `PaymentProviderAdapter` interface and `PaymentProviderFactory` resolving gateway adapters dynamically.
- **Strict Production Isolation (Fail-Closed Config)**:
  - `STRIPE_MOCK_CLIENT=true` is **strictly prohibited** when `NODE_ENV=production`.
  - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **required** in production; placeholder or missing values cause startup failure.
  - Test payment provider is preserved for local/testing only and strictly blocked when `NODE_ENV === 'production'`.
- **Authenticated Session Creation**: `POST /v1/orders/:orderId/payment-session` enforces user ownership, `PENDING_PAYMENT` order status, and immutable pricing/currency from database. Validates redirect URLs and rejects untrusted external origins.
- **Idempotent Session Reuse**: If an active session already exists for the same provider, the provider's `getPaymentSession()` is called to retrieve the existing `sessionUrl` without creating duplicates.
- **Provider Switch Prevention**: Once a payment has an active `providerReference` on one provider, switching to another provider is rejected with 409 Conflict.
- **Webhook Security**:
  - `POST /v1/webhooks/payments/:provider` immediately rejects non-Buffer or empty `rawBody` (length === 0) with 400 `BadRequestException("Missing or empty raw webhook payload")`.
  - HMAC-SHA256 signature verification via `stripe.webhooks.constructEvent` with configurable timestamp tolerance (default 300s, max 900s).
  - Causes ZERO DB mutations on rejected signatures.
- **Exact Provider Reference Matching**: Webhook `session.id` must exactly match `payment.providerReference` — zero `cs_* <-> pi_*` cross-matching exceptions.
- **Fail-Closed Binding Verification**: Validates expected amount, currency, orderId, and providerReference before mutating state.
- **Atomic Success Transaction**: Single transaction executes: Check/Insert `PaymentEvent` (`@@unique([provider, externalEventId])`), CAS transition Payment to `SUCCEEDED`, CAS transition Order to `PAID`, insert `ORDER_PAID` Outbox event (protected by `unique_order_paid_outbox` partial unique index), and insert `AuditLog`. Rollback on any failure.
- **Duplicate Payment Detection**: If webhook arrives for an order already in `PAID` status, the duplicate is detected, a `DUPLICATE_PAYMENT_DETECTED` audit anomaly is logged, and no second `ORDER_PAID` outbox event is emitted.
- **Terminal State Safety**: `SUCCEEDED`, `FAILED`, and `CANCELLED` are terminal states and are strictly preserved via CAS.
- **Concurrent Race Idempotency**: Concurrent `payment.failed` and `payment.cancelled` webhooks are handled idempotently via Prisma P2002 catch, returning the current DB state without error.
- **Secret Hygiene**: Zero credit card PAN, CVV, provider secrets, or auth headers stored. Error messages are generic (`"Upstream payment provider failure"`) without leaking Stripe internal errors. `raw_payload_hash` stored on `payment_events` for cryptographic non-repudiation.
- **RBAC**:
  - `GET /v1/payments/:id` requires authentication; non-staff users can only access their own payments (returns 404 for cross-user); sensitive metadata fields stripped for non-staff.
  - `POST /v1/payments/:id/reconcile` requires `payment.manage` permission.
  - Permissions `payment.read` and `payment.manage` seeded for `finance`, `ops`, `admin`, `super_admin` roles.
- **Active Reconciliation**: `reconcilePayment()` enforces exact `providerReference`, `amount`, and `currency` binding checks before processing. Supports typed `PaymentReconcileReason` enum (`scheduled_sweep`, `ops_manual`, `abandoned_check`, `authoritative_query`).
- **ORDER_PAID Outbox Constraint**: PostgreSQL partial unique index `unique_order_paid_outbox` on `outbox_events(aggregate_id) WHERE aggregate_type = 'Order' AND event_type = 'ORDER_PAID'` guarantees exactly-once outbox delivery at the database level.
- **Read-Only Frontend Checks**: `GET /v1/payments/:id` and order lookups are strictly read-only and never mark orders as paid.

### Phase 9 Round 3 — Authoritative Payment Hardening
- **Browser evidence is never authoritative**: a browser redirect to the resolved success/cancel URL, a bare `session_id` query parameter, or the mere existence of a provider Checkout Session never marks an Order `PAID`. Only a verified, signature-checked provider event (webhook) or an actively queried authoritative provider status (reconciliation) — both routed through the single private `processAuthoritativePaymentEvent` authority in `PaymentsService` — can transition state.
- **`checkout.session.completed` alone is not proof of payment**: the adapter only emits `payment.succeeded` when `payment_status === "paid"`; a completed session with a different `payment_status` is parsed as `ignored` and cannot reach the authority function.
- **Expired/cancelled payment ATTEMPT ≠ cancelled Order**: when a Stripe Checkout Session expires (`checkout.session.expired`) the corresponding `Payment` row transitions `PENDING → CANCELLED`, but the `Order` deliberately stays `PENDING_PAYMENT`. A `Payment` attempt is not the `Order`; the customer must be able to retry the same `Order` with a brand-new `Payment` row. `Order` only ever reaches `CANCELLED` through the legacy Phase 4 test-provider flow, never through Phase 9 production Stripe webhooks.
- **Terminal payment attempts never resurrect**: `SUCCEEDED`, `FAILED`, and `CANCELLED` are permanently terminal per `Payment` row. A delayed/out-of-order/stale authoritative event for a terminal `Payment` (including one superseded by a newer retry attempt on the same `Order`) is recorded as a `PaymentEvent` for audit purposes but never mutates state and never emits a second `ORDER_PAID` outbox event.
- **One live attempt per Order**: PostgreSQL partial unique index `unique_pending_payment_per_order` on `payments(order_id) WHERE status = 'PENDING'` guarantees at most one active `PENDING` `Payment` row per `Order` even under concurrent session-creation requests; application code additionally reuses the existing `PENDING` row instead of relying solely on a pre-check.
- **Deterministic lock order**: the authoritative transition function always locks `Payment` then `Order` (`SELECT ... FOR UPDATE`) inside one transaction before validating invariants, so concurrent webhook/webhook, webhook/reconciliation, and session-retry/webhook races serialize cleanly with zero duplicate outbox events or corrupted mixed state.
- **Reconciliation shares the webhook's authority**: `reconcilePayment()` never applies its own weaker "status string" logic — it queries the provider, builds the same evidence shape, and calls the identical private authority function used by the webhook path. A missing/unavailable provider record or a still-pending provider status yields `transitioned: false` (fail-safe), never a false success.
- **Migrations are additive and non-destructive**: Phase 9 migrations never `DELETE`/`TRUNCATE`/`DROP` historical rows; the `unique_pending_payment_per_order` / `unique_order_paid_outbox` migration fails loudly (`RAISE EXCEPTION`) if pre-existing dirty data would violate the new invariant, requiring an explicit audited data repair instead of silent cleanup.
- **No generic status-mutation endpoint**: there is no `PATCH`/`PUT` route on `/v1/payments/:id` or elsewhere that lets any caller (including admin) set a `Payment`/`Order` status directly; the only two paths that can ever reach `SUCCEEDED`/`PAID` are the signed webhook and the RBAC-gated reconciliation authority.

### Phase 9 Round 4 — Stripe Live-Mode Boundary
- **Production requires a genuine live Stripe secret key**: `STRIPE_SECRET_KEY` must start with `sk_live_` when `NODE_ENV === "production"`; any `sk_test_*` key — placeholder or a real-looking test key — fails provider initialization closed. A production deployment can never boot against Stripe's test environment.
- **`livemode` is authoritative provider evidence, not just the key prefix**: `StripeConfig.expectedLivemode` is `true` only in production and `false` everywhere else (mock mode is exempt — it never touches the real Stripe network and is itself forbidden in production). Every place the adapter receives a Stripe-originated object checks `object.livemode === expectedLivemode` before trusting it.
- **A valid signature alone is insufficient**: `verifyWebhook()` checks `event.livemode` immediately after HMAC signature verification and *before* the event reaches `parseWebhookEvent`/business processing. A signature-valid webhook whose `livemode` does not match the configured environment is rejected with zero `PaymentEvent`, `Payment`, `Order`, outbox, or audit mutation — a test-mode event can never pay a production Order even with a correctly signed payload.
- **Checkout Session creation is mode-checked before persistence**: after `stripe.checkout.sessions.create()`, `createPaymentSession()` verifies `session.livemode === expectedLivemode` before returning the session to the caller. On mismatch it fails closed (generic `BadGatewayException`); `PaymentsService` only persists `providerReference` after the adapter call succeeds, so `Payment` stays `PENDING` with no reference and `Order` stays `PENDING_PAYMENT`.
- **Session retrieval and reconciliation are mode-checked the same way**: `getPaymentSession()` returns `null` (never fabricating a URL) and `queryPaymentStatus()` returns `null` (never a false status) whenever the retrieved Stripe object's `livemode` does not match `expectedLivemode`. Because `reconcilePayment()` treats a `null` provider status as "no provider status available", a test-mode Session — even one reporting `payment_status: "paid"` — can never transition a production Payment; the outcome is `transitioned: false`, fail-safe.
- **Mock mode remains the only non-production shortcut**: all of the above checks are skipped when `config.isMock` is true, which is itself impossible in production (`STRIPE_MOCK_CLIENT=true` still fails closed at startup). This keeps the entire Phase 4–73 acceptance suite, which runs Stripe in mock mode, unaffected by the live-mode boundary.

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
