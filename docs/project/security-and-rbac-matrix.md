# Security and RBAC matrix

Rà soát ngày 2026-10-20 trên code PR #48 (`867736e`, tập cha của `main`), bằng: trích xuất tự động guard/permission của mọi handler
(TypeScript AST), đọc code các route nhạy cảm, và chứng minh runtime trên API chạy với DB test cách ly. Các con số dưới đây là của PR #48;
`main` có 204 handler (PR #48 thêm 5 handler đối soát).

## 1. Kiến trúc kiểm soát truy cập

| Lớp | Cơ chế | Ghi chú |
|---|---|---|
| Guard toàn cục | Chỉ `FeatureFlagGuard` (module tắt → 404) | `AuthGuard`/`PermissionsGuard` **không** toàn cục: route thiếu `@UseGuards(AuthGuard…)` là công khai |
| Xác thực | `AuthGuard`: `Authorization: Bearer <token>`; vai trò/quyền đọc từ DB | Không dùng cookie → CSRF không áp dụng cho API |
| Phân quyền | `PermissionsGuard` + `@RequirePermissions(...)`; `super_admin` qua mọi kiểm tra | Không khai báo permission ⇒ mọi người dùng đã đăng nhập đều qua. Permission ở method **thay** (không cộng) permission ở class |
| Chủ sở hữu | Route phía khách không cần permission; service so `userId`/`customerId` | Rà lại toàn bộ route MVP có `:id` (mục 4) |
| Chữ ký | Webhook SePay (`Apikey`, `timingSafeEqual`, raw body); callback n8n (`AutomationHmacGuard`, chống replay 409); cổng thanh toán thử (HMAC, chặn ở production) | |

## 2. Thống kê endpoint

| Nhóm | Số handler | Kết luận |
|---|---|---|
| Tổng | 209 | |
| Có `AuthGuard` | 179 | |
| Không `AuthGuard` | 30 | Công khai có chủ đích hoặc có guard khác — mục 3 |
| `/admin` | 112 | 110 khai báo permission; 2 (đối soát list/detail) kiểm quyền trong handler (`finance.read` / `payment.read` / `payment.manage`) |
| Khai báo permission nhưng thiếu `PermissionsGuard` | 0 | |
| `PermissionsGuard` không có `AuthGuard` / sai thứ tự | 0 / 0 | |
| Permission route yêu cầu nhưng không có trong seed | 0 | |

## 3. Endpoint không có AuthGuard

| Endpoint | Bảo vệ | Đánh giá |
|---|---|---|
| `GET /features` | — | Công khai có chủ đích (frontend ẩn module tắt) |
| `GET /products`, `/products/:slug`, `/categories`, `/categories/:slug/products` | — | Catalog công khai |
| `GET /content/posts`, `/posts/:slug`, `/pages/:slug`, `/categories` | Chỉ nội dung đã xuất bản (AC 11, E2E ST13) | Công khai có chủ đích |
| `GET /services`, `/services/:slug` | Flag `services` | Công khai khi bật |
| `GET /subscriptions/plans`, `POST /affiliates/click` | Flag `membership` / `affiliate` (tắt ở production) | NOT APPLICABLE |
| `POST /internal/automation/*` (3) | `AutomationHmacGuard` (HMAC + timestamp + chống replay) | OK |
| `POST /v1/webhooks/payments/:provider` | Xác thực theo provider trên raw body | OK |
| `POST /payments/test-callback` | HMAC; `ForbiddenException` khi `NODE_ENV=production` hoặc chưa bật `ENABLE_TEST_PAYMENT_PROVIDER` | OK |
| `GET /payments/providers` | — | Công khai (danh sách cổng) |
| `POST /v1/licenses/activate|validate|deactivate`, `POST /v1/updates/check` | License key 128 bit (`crypto.randomBytes`) | Không đoán được key; **chưa giới hạn tần suất** — SEC-4 |
| `GET /health`, `/db`, `/redis`, `/storage`, `/liveness`, `/readiness` | — | Chỉ trả trạng thái/thông báo chung |
| `GET /health/metrics` | — | Lộ phiên bản Node, PID, bộ nhớ, uptime; Caddy chuyển mọi route — SEC-3 |

## 4. Kiểm tra chủ sở hữu (IDOR) — route khách hàng có `:id`

33 route khách có tham số, có `AuthGuard`, không permission. 24 route thuộc phạm vi MVP đều truyền ID người dùng đã xác thực xuống service và
service/domain engine kiểm chủ sở hữu (trả 404/403):

| Nhóm | Route | Kiểm tra |
|---|---|---|
| Giỏ hàng | `PATCH/DELETE /cart/items/:itemId` | `cartItem.cart.userId !== userId` → 403 |
| Đơn, thanh toán | `GET /orders/:id`, `POST /v1/orders/:orderId/payment-session`, `GET /payments/:id`, `POST /payments/:id/refresh` | so chủ đơn; `/payments/:id` không phải staff thì 404 và ẩn secret trong metadata |
| Quyền sử dụng, tải | `GET /entitlements/:id`, `GET /v1/downloads/entitlements/:entitlementId/versions` | `entitlement.userId !== userId` → 404 |
| License nội bộ | `GET /licenses/:id`, `POST /:id/reveal`, `GET /:id/activations`, `POST /:id/deactivate-domain` | `where: { id, userId }` trong engine; reveal ghi audit chỉ với 4 ký tự cuối |
| License quản lý hộ | `POST/GET /entitlements/:id/allocations`, `POST …/:allocationId/request-deactivation` | engine: chủ entitlement / `allocation.user_id !== actorId` → 403 |
| Ticket, thông báo | `GET /tickets/:id`, `POST /tickets/:id/reply`, `PATCH /notifications/:id/read` | `userId` khớp, nếu không → 404 |
| Services | `GET /v1/me/service-inquiries/:id` (+ attachment URL), `GET/POST /v1/me/service-projects/:id` (+ messages, documents, document URL) | `getMine`, `requireOwnedOpenProject`, `canCustomerAccess*` |

9 route còn lại thuộc Hosting/Finance/Membership (flag tắt ở production) — NOT APPLICABLE, chưa rà chi tiết.

## 5. Vai trò và quyền

8 vai trò, 42 quyền (seed `packages/database/src/seed.ts`, sau bản sửa PR #52). `super_admin` vượt mọi kiểm tra quyền dù không liệt kê.

| Quyền | customer | support_agent | content_editor | product_manager | finance | ops | admin | super_admin |
|---|---|---|---|---|---|---|---|---|
| `affiliate.manage` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `affiliate.read` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `audit.read` |  |  |  |  | ✓ | ✓ | ✓ | ✓ |
| `automation.manage` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `automation.read` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `content.publish` |  |  | ✓ |  |  |  | ✓ | ✓ |
| `content.read` |  |  | ✓ | ✓ |  |  | ✓ | ✓ |
| `content.write` |  |  | ✓ |  |  |  | ✓ | ✓ |
| `entitlement.manage` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `entitlement.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `finance.manage` |  |  |  |  | ✓ |  |  |  |
| `finance.read` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `hosting.manage` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `hosting.read` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `inquiry.manage` |  | ✓ |  |  |  |  | ✓ | ✓ |
| `inquiry.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `invoice.read` |  |  |  |  | ✓ |  |  |  |
| `license.manage` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `license.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `notification.manage` |  | ✓ |  |  |  | ✓ | ✓ |  |
| `notification.read` | ✓ | ✓ |  |  |  | ✓ | ✓ |  |
| `order.manage` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `order.read` |  | ✓ |  |  | ✓ |  | ✓ | ✓ |
| `order.refund` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `payment.manage` |  |  |  |  | ✓ | ✓ | ✓ | ✓ |
| `payment.read` |  |  |  |  | ✓ | ✓ | ✓ | ✓ |
| `product.publish` |  |  |  | ✓ |  |  | ✓ | ✓ |
| `product.read` |  |  |  | ✓ |  |  | ✓ | ✓ |
| `product.write` |  |  |  | ✓ |  |  | ✓ | ✓ |
| `profile.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `profile.update` | ✓ |  |  |  |  |  | ✓ | ✓ |
| `project.manage` |  |  |  |  |  | ✓ | ✓ | ✓ |
| `project.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `service.manage` |  |  |  | ✓ |  |  | ✓ | ✓ |
| `service.read` |  |  |  | ✓ |  |  | ✓ | ✓ |
| `settings.manage` |  |  |  |  |  |  | ✓ | ✓ |
| `subscription.manage` |  |  |  |  |  |  | ✓ | ✓ |
| `subscription.read` |  |  |  |  | ✓ |  | ✓ | ✓ |
| `ticket.manage` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `ticket.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |
| `user.manage` |  |  |  |  |  |  | ✓ | ✓ |
| `user.read` |  | ✓ |  |  |  | ✓ | ✓ | ✓ |

## 6. Phát hiện

| ID | Mức | Phát hiện | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| SEC-1 | **P0** | Vai trò `customer` có `order.read`, `ticket.read`, `invoice.read` — đúng các quyền mở route staff: khách đọc được **mọi** đơn hàng và ticket (kể cả ghi chú nội bộ) qua `/admin/orders`, `/admin/tickets` | Runtime: token khách → `/admin/tickets` 200, 3/5 ticket của người khác; sau sửa → 403, admin 200, route khách 200 | Sửa ở PR #52 (seed + test bất biến), chưa merge |
| SEC-2 | **P0** | Replay guard n8n chấp nhận replay khi Redis có mật khẩu; mặc định ngầm `127.0.0.1:6379` | Redis thật có mật khẩu: 7/200 replay lọt | Sửa ở PR #50, chưa merge |
| SEC-3 | P2 | `GET /health/metrics` công khai lộ phiên bản Node, PID, bộ nhớ | Đọc code + Caddyfile | Mở — giới hạn nội bộ hoặc yêu cầu xác thực |
| SEC-4 | P2 | Endpoint license công khai không giới hạn tần suất | Đọc code | Mở — rate limit theo IP |
| SEC-5 | P2 | Route chẩn đoán `rbac/test/*` đăng ký cả ở production | `auth.module.ts` | Mở |

## 7. Kiểm soát đã xác minh (không phát hiện vấn đề)

- `ValidationPipe({ whitelist: true, transform: true })` toàn cục — loại thuộc tính lạ (mass assignment).
- SQL: Prisma; raw SQL dùng tagged template hoặc `$queryRawUnsafe` với tham số vị trí (`$1`).
- CORS: production fail-closed (bắt buộc HTTPS, cấm loopback, chỉ origin đã cấu hình).
- HTML nội dung CMS/AI: `sanitize-html` (AC 11 gate 12, AC 12 gate 28).
- Gọi HTTP ra ngoài với URL do người dùng ảnh hưởng: chỉ adapter Hosting (endpoint do admin cấu hình, module tắt).

## 8. Chưa xác minh

- Xác thực token Supabase thật, hết hạn phiên, vai trò từ Supabase → DB: **BLOCKED** (B3).
- Header bảo mật, TLS, cookie phía Caddy/Cloudflare trên môi trường thật: **BLOCKED** (B2).
- Rate limit theo IP thật sau reverse proxy (`TRUST_PROXY_HOPS`) trên topology thật: **BLOCKED** (B2).
- Quét lỗ hổng dependency (`pnpm audit`) và license phần mềm: chưa làm.
- Vai trò staff chỉ đọc trong luồng đối soát AD10 và gán/gỡ vai trò: chỉ có unit (P0-2).
