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
9. Phase 9 — Production Payment (Stripe, VietQR, OpenBanking, automated reconciliations)
10. Phase 10 — Customer Portal (License center, download hub, domain binding GUI)
11. Phase 11 — CMS & SEO (Editorial content, programmatic SEO, dynamic metadata)
12. Phase 12 — n8n Automation (AI-assisted drafts, operational notifications)
13. Phase 13 — Affiliate & Membership (Tiered access, recurring entitlements, referral tracking)
14. Phase 14 — Hosting Integration (cPanel/DirectAdmin/Cloudflare automation)
15. Phase 15 — Hardening & Production (Penetration testing, rate limiting, disaster recovery)

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
