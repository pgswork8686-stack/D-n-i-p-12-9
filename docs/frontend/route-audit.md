# Route audit — 50 màn frontend

> Commit audit: `85b14eb` (main, 12/10/2026). Mọi route, endpoint và permission dưới đây đọc trực tiếp từ source tại commit này; không có giá trị nào được suy đoán. Nếu code thay đổi, audit phải chạy lại.
>
> Trạng thái: `REUSE` (đủ hành vi, chỉ chuẩn hóa UI) · `REFACTOR` (có route, thiếu layout/state) · `IMPLEMENT` (route mới, API đã có) · `DEMO_ONLY` (thiếu API/nghiệp vụ — chỉ dựng trong chế độ mô phỏng, gắn nhãn) · `BLOCKED` (chờ chủ dự án quyết định).

## 1. Hiện trạng ba app

| App | Ngôn ngữ UI | Shell | Token / font | Ghi chú |
|---|---|---|---|---|
| `apps/web` (:3000) | Tiếng Việt | `components/site-header.tsx`, `site-footer.tsx` | CSS vars (`--brand`, `--ink`, …) trong `tailwind.config.js`; Be Vietnam Pro qua `next/font` | Gần với spec nhất. Đổi màu sang token ST01 chỉ cần sửa CSS vars. |
| `apps/portal` (:3001) | **Tiếng Anh** | `components/portal-shell.tsx` (sidebar + drawer mobile) | Hex cứng `#0037b0`, icon emoji | Có sẵn `empty-state`, `error-state`, `skeleton`, `status-badge`, `auth-guard`. Đã ẩn module theo `GET /v1/features`. |
| `apps/admin` (:3002) | **Tiếng Anh** | **Không có shell** — `layout.tsx` chỉ bọc `AuthProvider` | Hex cứng, icon emoji | Trang chủ là trang chẩn đoán dev (health JSON, nút token giả). Route bị chia đôi: `/admin/products`, `/admin/orders` vs `/content`, `/automation` (có alias `/admin/content`, `/admin/automation` re-export). |

`packages/ui` hiện có: `badge`, `button`, `card`, `cart-drawer`, `download-button`, `faceted-filter`, `license-key-card`, `price-display`, `product-version-badge`. Chưa có: `PageHeader`, `SectionHeader`, `DataTable`, `ConfirmDialog`, `FormField`, `ResponsiveDrawer`, `Toast`. `EmptyState`/`ErrorState`/`Skeleton`/`StatusBadge` đang nằm trong `apps/portal/app/components` — nên chuyển lên `packages/ui`.

Admin products/orders gọi `fetch()` thô (`apps/admin/app/admin/products/page.tsx:39`, `admin/orders/page.tsx:40`, `admin/products/[id]/page.tsx:53-139`); phần còn lại dùng `@nexus/sdk`.

## 2. Ràng buộc dữ liệu phát hiện khi audit

- **Không có `total` ở list khách hàng**: `GET /orders`, `/entitlements`, `/licenses`, `/tickets` trả mảng. Chỉ catalog (`PaginatedResponse<T>` — `packages/contracts/src/catalog.ts:272`) và automation jobs (`automation.ts:99`) có `total`. ⇒ PT01/PT08 **không được hiển thị số tổng**; action strip chỉ là link.
- **Không có endpoint public cho trang `PAGE`**: `content.service.ts:520,587` lọc cứng `contentType: ARTICLE`. ⇒ ST13 không thể đọc chính sách từ CMS nếu không sửa backend.
- **Không có endpoint lead/tư vấn**: form tư vấn ST01 không có nơi gửi.
- **Không có endpoint cập nhật hồ sơ**: chỉ `GET /auth/me`.
- **Không có list payments cho admin**: chỉ `GET /payments/:id`, `POST /payments/:id/refresh`, `POST /payments/:id/reconcile` (`payment.manage`).
- **Không có media library API**: `media_assets` có trong mô hình nhưng không có controller.
- **Không có reset password trong code**: không file nào gọi `resetPasswordForEmail` / `updateUser`.
- **Kích hoạt license nội bộ** chỉ qua `POST /v1/licenses/activate` (plugin trên site khách, cần key). Portal chỉ có `POST /licenses/:id/deactivate-domain`. ⇒ PT07 internal = xem/hủy activation + hướng dẫn, không có form "kích hoạt" từ portal.
- Module tắt ở production (`FEATURE_HOSTING|MEMBERSHIP|AFFILIATE|FINANCE`): `/hosting`, `/affiliate`, `/subscription`, `/invoices` của portal **nằm ngoài 50 màn** và không đụng tới.

## 3. Bảng audit

Đường dẫn file tương đối từ `apps/<app>/app/`. Endpoint ghi theo prefix chính (phần lớn controller có alias `v1/…`).

### Storefront (`apps/web`)

| ID | Màn | Route hiện có | File | API (đã xác nhận) | Guard | Trạng thái |
|---|---|---|---|---|---|---|
| ST01 | Trang chủ | `/` | `page.tsx` (247L) | `GET /products`, `GET /categories`, `GET /content/posts` | public | `REFACTOR` — bố cục hiện tại là split chữ trái/minh họa phải, chưa có R5 (WP gallery), R6 (Plugin/UI Kit), R8 (form tư vấn). Form tư vấn: `DEMO_ONLY`. |
| ST02 | Danh mục & tìm kiếm | `/products` | `products/page.tsx` (173L) | `GET /products` (q, category, sort, page, limit → `total`), `GET /categories` | public | `REFACTOR` |
| ST03 | Chi tiết sản phẩm | `/products/[slug]` | `products/[slug]/page.tsx`, `product-variant-selector.tsx` | `GET /products/:slug` | public | `REFACTOR` |
| ST04 | Giỏ hàng | `/cart` | `cart/page.tsx` (150L), `lib/cart.tsx` | `GET/POST/PATCH/DELETE /cart…` | theo `lib/cart.tsx` | `REFACTOR` |
| ST05 | Checkout | `/checkout` | `checkout/page.tsx` (247L) | `POST /checkout`, `GET /payments/providers` | đăng nhập | `REFACTOR` |
| ST06 | Thanh toán VietQR | `/orders/[id]` | `orders/[id]/page.tsx` | `GET /orders/:id`, `POST /orders/:id/payment-session` (trả `instructions.amount`, `transferContent`, QR) | owner | `REFACTOR` |
| ST07 | Kết quả thanh toán | `/orders/[id]` (trạng thái PAID) + portal `/payment/result` | `orders/[id]/page.tsx`; portal `payment/result/page.tsx` | `GET /orders/:id` (read-only, `syncPaymentResultStatus`) | owner | `REFACTOR` — cần quyết định 1 route chuẩn (xem §4). |
| ST08 | Đăng nhập | `/login` | `login/page.tsx` → `components/auth-form.tsx` | Supabase `signInWithPassword` | public | `REFACTOR` |
| ST09 | Đăng ký | `/register` | `register/page.tsx` → `auth-form.tsx` | Supabase `signUp` | public | `REFACTOR` |
| ST10 | Khôi phục mật khẩu | — | — | Supabase `resetPasswordForEmail` + `updateUser` (SDK có sẵn, chưa dùng) | public/token | `IMPLEMENT` — auth thật, không cần backend mới; cần cấu hình redirect URL trên Supabase. |
| ST11 | Blog | `/blog`, `/blog/category/[slug]` | `blog/page.tsx`, `components/post-grid.tsx` | `GET /content/posts`, `GET /content/categories` | public | `REFACTOR` |
| ST12 | Chi tiết bài viết | `/blog/[slug]` | `blog/[slug]/page.tsx` | `GET /content/posts/:slug` (sanitize sẵn) | public | `REFACTOR` |
| ST13 | Trang tĩnh / chính sách | — | — | **không có** (public chỉ trả ARTICLE) | public | `DEMO_ONLY` → `BLOCKED` cho bản thật (cần endpoint PAGE + nội dung pháp lý được duyệt). |

### Customer Portal (`apps/portal`)

| ID | Màn | Route hiện có | File | API | Guard | Trạng thái |
|---|---|---|---|---|---|---|
| PT01 | Dashboard | `/` | `page.tsx` (297L) | `GET /orders`, `/entitlements`, `/licenses` | `auth-guard` | `REFACTOR` — bỏ số tổng (API không trả `total`). |
| PT02 | Sản phẩm của tôi | `/entitlements` | `entitlements/page.tsx` | `GET /entitlements` | owner | `REFACTOR` |
| PT03 | Trung tâm tải xuống | `/downloads` | `downloads/page.tsx` (253L) | `GET /v1/downloads/entitlements/:id/versions`, `POST /v1/downloads/request` | owner | `REFACTOR` |
| PT04 | Phiên bản / changelog | `/entitlements/[id]` | `entitlements/[id]/page.tsx` | `GET /entitlements/:id`, `GET /v1/downloads/entitlements/:id/versions` | owner | `REFACTOR` |
| PT05 | Danh sách license | `/licenses` | `licenses/page.tsx` | `GET /licenses` (masked) | owner | `REFACTOR` |
| PT06 | Chi tiết license nội bộ | `/licenses/[id]` | `licenses/[id]/page.tsx`, `lib/portal-actions.ts` | `GET /licenses/:id`, `POST /licenses/:id/reveal`, `GET /licenses/:id/activations`, `POST /licenses/:id/deactivate-domain` | owner | `REFACTOR` |
| PT07 | Kích hoạt tên miền | `/allocations` (external) + `/licenses/[id]` (internal) | `allocations/page.tsx` (288L) | `POST/GET /entitlements/:id/allocations`, `POST …/allocations/:aid/request-deactivation` | owner | `REFACTOR` — external: form domain thật. Internal: không có activate từ portal (§2). |
| PT08 | Đơn hàng | `/orders` | `orders/page.tsx` | `GET /orders` | owner | `REFACTOR` |
| PT09 | Chi tiết đơn | `/orders/[id]` | `orders/[id]/page.tsx` | `GET /orders/:id` | owner | `REFACTOR` |
| PT10 | Ticket | `/tickets` | `tickets/page.tsx` (355L) | `GET/POST /tickets` | owner | `REFACTOR` |
| PT11 | Hội thoại ticket | `/tickets/[id]` | `tickets/[id]/page.tsx` | `GET /tickets/:id`, `POST /tickets/:id/reply` | owner | `REFACTOR` |
| PT12 | Thông báo | `/notifications` | `notifications/page.tsx` (232L) | `GET /notifications`, `GET …/unread-count`, `PATCH …/:id/read`, `POST …/read-all` | owner | `REUSE` (chuẩn hóa UI/ngôn ngữ) |
| PT13 | Thông tin cá nhân | `/account` | `account/page.tsx` (95L) | `GET /auth/me` | owner | `REFACTOR` (xem) + sửa hồ sơ `DEMO_ONLY` — không có API cập nhật. |
| PT14 | Bảo mật tài khoản | — | — | Supabase `updateUser({ password })` | owner | `IMPLEMENT` đổi mật khẩu; 2FA/phiên đăng nhập `BLOCKED` (chưa xác nhận Supabase MFA được bật). |

### Admin (`apps/admin`)

| ID | Màn | Route hiện có | File | API | Permission | Trạng thái |
|---|---|---|---|---|---|---|
| AD01 | Đăng nhập | `/login` | `login/page.tsx` (187L) | Supabase + `GET /auth/me` | public | `REFACTOR` |
| AD02 | Tổng quan vận hành | `/` (trang chẩn đoán) | `page.tsx` | không có summary endpoint; dùng `GET /health`, `GET /admin/orders`, `GET /admin/automation/jobs` (`total`) | `order.read`, `automation.read` | `REFACTOR` — thay trang dev; không tự tính KPI từ trang dữ liệu. |
| AD03 | Danh sách sản phẩm | `/admin/products` | `admin/products/page.tsx` | `GET /admin/products` | `product.read` | `REFACTOR` (+ chuyển sang SDK) |
| AD04 | Tạo/sửa sản phẩm | `/admin/products/new`, `/admin/products/[id]` | tương ứng | `POST/GET/PATCH/DELETE /admin/products…` | `product.write` | `REFACTOR` |
| AD05 | Phiên bản & file | — | — | `GET/POST /admin/products/:pid/versions`, `GET /admin/product-versions/:id`, `POST …/files/upload`, `POST …/publish` | `product.read/write/publish` | `IMPLEMENT` |
| AD06 | Danh mục sản phẩm | — | — | `GET/POST/PATCH /admin/categories` | `product.read/write` | `IMPLEMENT` |
| AD07 | Giá & gói license | trong `/admin/products/[id]` | `admin/products/[id]/page.tsx:109-139` | `POST /admin/products/:id/variants`, `PATCH/DELETE …/variants/:vid`, `POST /admin/variants/:vid/prices`, `PATCH /admin/prices/:pid` | `product.write` | `REFACTOR` — tách thành tab riêng. Không có API `license_plans` độc lập. |
| AD08 | Danh sách đơn | `/admin/orders` | `admin/orders/page.tsx` | `GET /admin/orders` | `order.read` | `REFACTOR` |
| AD09 | Chi tiết đơn | — | — | `GET /admin/orders/:id` | `order.read` | `IMPLEMENT` |
| AD10 | Đối soát thanh toán | — | — | `GET /payments/:id`, `POST /payments/:id/refresh`, `POST /payments/:id/reconcile` | `payment.manage` | `IMPLEMENT` (đối soát từng payment từ AD09). Hàng đợi "sai số tiền/nội dung": `BLOCKED` — không có list endpoint. |
| AD11 | Entitlement | — | — | `GET /admin/entitlements`, `GET …/:id`, `POST …/:id/revoke` | `entitlement.read/manage` | `IMPLEMENT` |
| AD12 | License nội bộ | — | — | `GET /admin/internal-licenses`, `GET …/:id`, `POST …/:id/revoke` | `license.read/manage` | `IMPLEMENT` |
| AD13 | License quản lý hộ | — | — | `GET /admin/license-providers`, `…/provider-accounts`, `…/license-allocations` + `activate/reject/request-deactivation/confirm-deactivated` | `license.read/manage` | `IMPLEMENT` |
| AD14 | Khách hàng | — | — | `GET /admin/users`, `GET …/:id`, `GET /admin/roles`, `POST …/:id/roles`, `DELETE …/roles/:role` | `user.read/manage` | `IMPLEMENT` (đọc). Gán role: `BLOCKED` chờ xác nhận ai được dùng — spec cấm đổi RBAC. |
| AD15 | Ticket admin | — | — | `GET /admin/tickets` | `ticket.read` | `IMPLEMENT` |
| AD16 | Chi tiết ticket admin | — | — | `GET /admin/tickets/:id`, `PATCH …/:id`, `POST …/:id/reply` | `ticket.read/manage` | `IMPLEMENT` |
| AD17 | Bài viết CMS | `/content` (+ alias `/admin/content`) | `content/page.tsx` | `GET /admin/content/posts` | `content.read` | `REFACTOR` |
| AD18 | Biên tập bài viết | `/content/new`, `/content/[id]` | tương ứng | `POST/PATCH /admin/content/posts…`, transition (`admin-content.controller.ts:84`, `content.publish`) | `content.write/publish` | `REFACTOR` |
| AD19 | Danh mục / Media CMS | `/content/categories` | `content/categories/page.tsx` | `GET/POST/PATCH /admin/content/categories` | `content.read/write` | `REFACTOR` (danh mục); Media `DEMO_ONLY` — không có API. |
| AD20 | Automation & jobs | `/automation`, `/automation/[id]` (+ alias `/admin/…`) | tương ứng | `GET /admin/automation/jobs(:id)`, `POST …/retry`, `…/cancel`, `POST …/ai-draft` | `automation.read/manage` | `REFACTOR` |

### System

| ID | Màn | Hiện có | Trạng thái |
|---|---|---|---|
| SY01 | 403 | Admin hiển thị lỗi inline trong `page.tsx`; không có trang riêng ở cả 3 app | `IMPLEMENT` (portal + admin; web không có vùng cần quyền ngoài owner→404) |
| SY02 | 404 | `web/app/not-found.tsx`; portal/admin không có | `REFACTOR` (web) + `IMPLEMENT` (portal, admin) |
| SY03 | 500 | `web/app/error.tsx`; không có `global-error.tsx`; portal/admin không có | `REFACTOR` (web) + `IMPLEMENT` (portal, admin) |

## 4. Tổng kết

| Trạng thái | Số màn | Ghi chú |
|---|---|---|
| `REUSE` | 1 | PT12 |
| `REFACTOR` | 35 | route có sẵn (SY02, SY03 tính ở đây dù portal/admin phải tạo mới) |
| `IMPLEMENT` | 13 | API có sẵn, chưa có UI (ST10, PT14, AD05, AD06, AD09–AD16, SY01) |
| `DEMO_ONLY` toàn màn | 1 | ST13 |
| Mục `DEMO_ONLY`/`BLOCKED` bên trong màn | 7 | form tư vấn ST01, sửa hồ sơ PT13, 2FA PT14, hàng đợi đối soát AD10, gán role AD14, media AD19, activate internal PT07 |

(Các SY tính theo màn; mỗi SY triển khai ở nhiều app.)

**Khoảng trống backend** — chỉ đóng được bằng cách thêm API, việc mà brief này không cho phép tự làm: endpoint lead/tư vấn · endpoint public `PAGE` · cập nhật hồ sơ · list payment cần đối soát · media library · số tổng (`total`) cho list khách hàng.
