# Kế hoạch triển khai — 50 màn frontend + chế độ mô phỏng

Dựa trên [route-audit.md](route-audit.md) và [screen-registry.md](screen-registry.md). Mỗi batch = một PR riêng vào `main`, CI (`ci.yml`) phải xanh trước khi merge. Không batch nào sửa `apps/api`, `apps/worker`, `packages/database` hay quyền RBAC.

## 1. Thứ tự batch

| Batch | Nội dung | Màn | Phụ thuộc | Điều kiện xong |
|---|---|---|---|---|
| **B0** | Audit + registry + kế hoạch (PR này) | — | — | Chủ dự án duyệt §5 |
| **B1** | Nền tảng giao diện: preset Tailwind chung (token ST01, Be Vietnam Pro) cho cả 3 app; chuyển `EmptyState`, `ErrorState`, `Skeleton`, `StatusBadge` từ portal lên `packages/ui`; thêm `PageHeader`, `SectionHeader`, `DataTable` (bảng → list trên mobile), `ConfirmDialog`, `FormField` + `ErrorSummary`, `ResponsiveDrawer`, `Toast`; trang hệ thống 403/404/500 | SY01–SY03 | B0 | 3 app build; axe không có lỗi nghiêm trọng trên SY01–03 |
| **B2** | **Pilot ST01** — dựng trang chủ theo ảnh Stitch, gửi ảnh chụp desktop 1440 + mobile 390 để duyệt **trước khi** làm tiếp | ST01 | B1, ảnh tham chiếu | Chủ dự án duyệt pilot |
| **B3** | Storefront còn lại + ST10 khôi phục mật khẩu | ST02–ST12 | B2 đã duyệt | Luồng mua: ST02 → ST03 → ST04 → ST05 → ST06 chạy được trên stack local |
| **B4** | Portal: Việt hóa toàn bộ, shell mới (icon Lucide thay emoji, sidebar thu gọn được), 14 màn + PT14 đổi mật khẩu | PT01–PT14 | B1 | Không còn chuỗi tiếng Anh; không hiển thị số tổng tự tính |
| **B5** | Admin phần 1: shell admin (sidebar theo domain, ẩn mục theo permission từ `/auth/me`), thay trang chẩn đoán, chuyển `fetch()` thô sang SDK; catalog + đơn hàng | AD01–AD09 | B1, Q2 | Trang dev (nút token giả) chỉ còn khi `isDevAuthToolsEnabled()` |
| **B6** | Admin phần 2: thanh toán, quyền sử dụng, license, khách hàng, ticket, CMS, automation | AD10–AD20 | B5 | Mọi hành động phá hủy (revoke, reject, cancel) có `ConfirmDialog` |
| **B7** | Chế độ mô phỏng (§3) + các phần `DEMO_ONLY` | ST13 + phần demo của ST01, PT13, PT14, AD10, AD14, AD19 | B3–B6 | Click được đủ 50 màn trong demo; build production không chứa mã demo (§3.3) |
| **B8** | QA: Playwright smoke 50 màn (desktop 1440 + mobile 390), axe-core, 3 luồng xuyên app; ảnh chụp vào `docs/frontend/screenshots/`; `qa-report.md` với log thực | tất cả | B7 | `pnpm lint/typecheck/test/build` + E2E chạy thật, log đính kèm |

B3 và B4 có thể chạy song song sau B2; B5 song song với B4.

## 2. Quy ước chung cho mọi batch

- **Token**: một preset dùng chung (`packages/config/tailwind-preset.js`, nếu `packages/config` phù hợp) chứa bảng màu ST01. Web hiện dùng CSS vars nên chỉ đổi giá trị; portal/admin phải bỏ hex cứng `#0037b0`.
- **Hàng ngang theo chủ đề** (spec §2.2): `SectionHeader` (tiêu đề + mô tả trái, hành động phải trên một hàng) là khung bắt buộc cho mọi nhóm nội dung; danh sách dữ liệu admin dùng `DataTable` full-width, không bọc trong card 3 cột.
- **Số liệu**: chỉ hiển thị `total` khi API trả `total` (catalog, automation jobs). Danh sách khách hàng hiện không có — dashboard dùng link, không dùng số.
- **Trạng thái**: mỗi màn có loading (Skeleton), empty, error (có thử lại), 403/404; form có lỗi theo trường + `ErrorSummary`, chặn submit hai lần.
- **Không đổi hành vi**: refactor giữ nguyên các hàm trong `apps/portal/app/lib/portal-actions.ts` (đang có test hành vi) — chỉ thay phần trình bày.

## 3. Chế độ mô phỏng (B7)

### 3.1. Cách làm

- Bật bằng `NEXT_PUBLIC_DEMO_MODE=1`, chỉ trong `pnpm dev:demo` (script mới) — không bao giờ trong `build` production.
- Dùng **MSW** (Mock Service Worker) để chặn request của `@nexus/sdk` (SDK gọi `fetch` toàn cục — `packages/sdk/src/client.ts:205`) và trả fixture. Không sửa SDK, không dựng backend thứ hai. Trang Server Component của web (`lib/server-api.ts`) cần MSW phía Node qua `instrumentation.ts` — **rủi ro kỹ thuật**, sẽ thử trước trong B7; nếu không ổn định thì dùng adapter fixture ở tầng `server-api.ts` khi bật demo.
- Fixture cố định, có hạt giống (seed) để tái lập; nút **Đặt lại** xóa trạng thái trong bộ nhớ.
- Thanh công cụ demo nổi ở mọi trang: badge **DỮ LIỆU MÔ PHỎNG**, chọn persona (khách chưa mua · khách đã mua theme + UI kit · admin · content editor · khách bị 403), chọn tình huống theo màn (vd. ST06: chờ → đã xác nhận / sai số tiền; PT03: tải được / hết hạn cập nhật / rate limit / lỗi storage), nút đặt lại.
- Màn `DEMO_ONLY` nằm dưới `/demo/*` và luôn có nhãn nêu lý do (vd. "Chưa có API gửi yêu cầu tư vấn — không có yêu cầu nào được gửi").

### 3.2. Điều demo không làm

Không gọi API thật khi bật demo; không webhook thanh toán; không seed database; không đặt `PAID` hay cấp entitlement ở client ngoài bộ nhớ fixture của MSW; không dùng license key thật (fixture dùng chuỗi rõ ràng là giả, vd. `NXS-DEMO-…`).

### 3.3. Hàng rào production

- `next.config` ném lỗi khi `NODE_ENV=production` và `NEXT_PUBLIC_DEMO_MODE=1`.
- Mã demo nạp bằng `import()` động sau kiểm tra cờ, để không lọt vào bundle production; B8 thêm kiểm tra grep bundle production không chứa chuỗi `DỮ LIỆU MÔ PHỎNG`.

### 3.4. Kiểm thử tích hợp thật (tách khỏi demo)

E2E chạy trên stack local hiện có (`docker-compose.yml`, `pnpm db:seed:local`, test payment provider vốn đã bị chặn ở production) — đây mới là bằng chứng backend hoạt động; demo thì không chứng minh điều đó.

## 4. Thư viện dự kiến thêm

| Thư viện | Batch | Lý do | Ghi chú |
|---|---|---|---|
| `lucide-react` cho portal/admin | B4, B5 | thay emoji; web đã dùng `^0.460.0` | cùng phiên bản với web |
| `@radix-ui/react-dialog`, `react-dropdown-menu` | B1 | focus trap/Escape cho ConfirmDialog, Drawer | MIT; kiểm tra advisory khi thêm |
| `msw` | B7 | mô phỏng request | chỉ devDependency |
| `@playwright/test`, `@axe-core/playwright` | B8 | E2E + a11y | devDependency |

TanStack Query/Table, React Hook Form, Zod: **chưa thêm** — các trang hiện dùng state cục bộ ổn; chỉ đề xuất nếu một batch cụ thể cần, kèm lý do trong PR.

## 5. Câu hỏi cần chủ dự án quyết định

| # | Câu hỏi | Chặn batch | Đề xuất |
|---|---|---|---|
| Q1 | Ảnh tham chiếu ST01 chưa có trong repo. Cần chép vào `docs/frontend/references/ST01-homepage.png` (desktop) và bản mobile nếu có. | B2 | — |
| Q2 | Admin đang có hai cây route: `/admin/products`, `/admin/orders` và `/content`, `/automation` (kèm alias `/admin/content`). Chọn một chuẩn? | B5, B6 | Chuẩn hóa về `/admin/*`, route gốc cũ chuyển hướng 308 để không gãy link. |
| Q3 | ST07: kết quả thanh toán đang có ở hai nơi — web `/orders/[id]` và portal `/payment/result`. | B3 | Web `/orders/[id]` là ST07 (luồng mua kết thúc trên storefront); portal `/payment/result` giữ nguyên làm trang quay về sau Stripe. |
| Q4 | Khoảng trống backend (route-audit §4): tư vấn, trang `PAGE`, sửa hồ sơ, hàng đợi đối soát, media, `total`. Có muốn mở PR backend riêng cho mục nào không? | không chặn — mặc định `DEMO_ONLY` | Ưu tiên endpoint public `PAGE` (ST13 cần cho chính sách thật) và `total` cho list khách hàng. |
| Q5 | Supabase MFA có được bật cho dự án không? | PT14 (phần 2FA) | Giữ `BLOCKED` tới khi xác nhận. |
| Q6 | Phần spec sau PT11 bị cắt khi dán (AD01–AD20, SY, chi tiết mô phỏng, QA). | B5–B8 | Gửi lại phần còn lại; tới lúc đó AD/SY dựng theo bảng §5.0 của spec + API thực tế. |
