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

### 3.1. Cách làm (theo spec §6)

Ba chế độ: `INTEGRATED_LOCAL` (API/DB/Redis/MinIO local thật + `pnpm db:seed:local`) · `DEMO_SIMULATION` · `PRODUCTION`.

- **Ưu tiên 1 — dùng stack local thật** cho mọi luồng đã có API (đa số 50 màn). Thanh toán chỉ qua test provider sẵn có (đã bị chặn ở production).
- **Ưu tiên 2 — một demo API dùng chung** (`apps/demo-api` hoặc `tools/demo-api`, quyết định ở B7) cho phần thiếu backend và cho các tình huống khó dựng trên stack thật (lỗi storage, rate limit, sai số tiền). Một server stateful duy nhất cho cả 3 app để dữ liệu liên thông (khách tạo ticket ở Portal → Admin thấy). Server này **mô phỏng chuỗi** payment verified → order PAID → entitlement; React không bao giờ tự đặt trạng thái. **Không** dùng MSW riêng từng app (spec §6.1 cấm). Chỉ tồn tại khi dev, không có Dockerfile production.
- Cờ `FRONTEND_DEMO_MODE` (mới, mặc định `false`); chỉ có hiệu lực khi `NODE_ENV !== 'production'`. Khi bật, các app trỏ API base URL sang demo API.
- State demo tách theo `demoSessionId`; **Đặt lại** xóa namespace đó, có xác nhận.
- **Demo Control Center** tại web `/dev/showcase` (đã kiểm tra: web chưa có route `/dev`), không tính là màn 51: badge **DỮ LIỆU MÔ PHỎNG**, card ngang Storefront 13 · Portal 14 · Admin 20 · System 3 (trạng thái Đã code / Chỉ demo / Đang thiếu), persona (Khách chưa mua · Khách đã mua · Nhân sự có quyền · Nhân sự không đủ quyền), tình huống (Default · Empty · Loading · Error · Forbidden · Conflict · Expired — chỉ hiện cái có nghĩa cho từng màn), 50 link theo registry, nhật ký sự kiện demo.
- Fixture theo spec §6.3 (8–12 sản phẩm, 5 bài published + 2 draft, 2 khách + 1 không quyền, 1 payment pending / 1 paid / 1 sai số tiền, …), mọi tên có nhãn `DEMO`.
- 16 kịch bản SIM01–SIM16 (spec §6.4), mỗi kịch bản có Playwright test + screenshot ở B8.
- Màn `DEMO_ONLY` luôn có nhãn nêu lý do (vd. "Chưa có API gửi yêu cầu tư vấn — không có yêu cầu nào được gửi").

### 3.2. Điều demo không làm

Không gọi API thật khi bật demo; không webhook thanh toán; không seed database; không đặt `PAID` hay cấp entitlement ở client ngoài bộ nhớ fixture của MSW; không dùng license key thật (fixture dùng chuỗi rõ ràng là giả, vd. `NXS-DEMO-…`).

### 3.3. Hàng rào production

- `next.config` ném lỗi khi `NODE_ENV=production` và `FRONTEND_DEMO_MODE=true`.
- Mã demo (control center, badge) nạp bằng `import()` động sau kiểm tra cờ, để không lọt vào bundle production; `/dev/showcase` trả 404 ở production. B8 thêm kiểm tra grep bundle production không chứa chuỗi `DỮ LIỆU MÔ PHỎNG`.

### 3.4. Kiểm thử tích hợp thật (tách khỏi demo)

E2E chạy trên stack local hiện có (`docker-compose.yml`, `pnpm db:seed:local`, test payment provider vốn đã bị chặn ở production) — đây mới là bằng chứng backend hoạt động; demo thì không chứng minh điều đó.

## 4. Thư viện dự kiến thêm

| Thư viện | Batch | Lý do | Ghi chú |
|---|---|---|---|
| `lucide-react` cho portal/admin | B4, B5 | thay emoji; web đã dùng `^0.460.0` | cùng phiên bản với web |
| `@radix-ui/react-dialog`, `react-dropdown-menu` | B1 | focus trap/Escape cho ConfirmDialog, Drawer | MIT; kiểm tra advisory khi thêm |
| (framework cho demo API) | B7 | server mô phỏng dùng chung | chọn ở B7, ưu tiên thứ đã có trong repo; chỉ dev |
| `@playwright/test`, `@axe-core/playwright` | B8 | E2E + a11y | devDependency |

TanStack Query/Table, React Hook Form, Zod: **chưa thêm** — các trang hiện dùng state cục bộ ổn; chỉ đề xuất nếu một batch cụ thể cần, kèm lý do trong PR.

## 5. Câu hỏi cần chủ dự án quyết định

| # | Câu hỏi | Chặn batch | Đề xuất |
|---|---|---|---|
| Q1 | ~~Ảnh tham chiếu ST01~~ — **đã có** (`references/ST01-homepage.png`, ghi chú ở `references/ST01-layout-notes.md`). Còn thiếu: bản gốc độ phân giải cao (ảnh hiện chỉ 374 px rộng) và bản mobile 390 nếu có. | B2 (độ chính xác chi tiết) | Xuất lại từ Stitch ở 1440 px |
| Q2 | Admin đang có hai cây route: `/admin/products`, `/admin/orders` và `/content`, `/automation` (kèm alias `/admin/content`). Chọn một chuẩn? | B5, B6 | Chuẩn hóa về `/admin/*`, route gốc cũ chuyển hướng 308 để không gãy link. |
| Q3 | ST07: kết quả thanh toán đang có ở hai nơi — web `/orders/[id]` và portal `/payment/result`. | B3 | Web `/orders/[id]` là ST07 (luồng mua kết thúc trên storefront); portal `/payment/result` giữ nguyên làm trang quay về sau Stripe. |
| Q4 | Khoảng trống backend (route-audit §4): tư vấn, trang `PAGE`, sửa hồ sơ, hàng đợi đối soát, media, `total`. Có muốn mở PR backend riêng cho mục nào không? | không chặn — mặc định `DEMO_ONLY` | Ưu tiên endpoint public `PAGE` (ST13 cần cho chính sách thật) và `total` cho list khách hàng. |
| Q5 | Supabase MFA có được bật cho dự án không? | PT14 (phần 2FA) | Giữ `BLOCKED` tới khi xác nhận. |
| Q6 | ~~Spec bị cắt~~ — **đã có bản đầy đủ** (`NEXUSTHEME_CLAUDE_CODE_50_SCREENS_FULL_SYSTEM_IMPLEMENTATION.md`, 2016 dòng); §3 kế hoạch này đã cập nhật theo spec §6. | — | — |
