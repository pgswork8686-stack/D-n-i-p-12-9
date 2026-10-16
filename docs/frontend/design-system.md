# Design system — NexusTheme

Nguồn chuẩn: thiết kế ST01 (Stitch) và file Figma "Hệ Thống Figma PGS" (trang `00 · Design System`, `01 · Demo — Luồng tương tác`). Code dùng chung một preset cho cả 3 app: [`packages/config/tailwind-preset.js`](../../packages/config/tailwind-preset.js).

## 1. Token màu

Khai báo dạng kênh RGB trong CSS variable (`:root`) để dùng được alpha (`bg-brand/10`). Figma dùng cùng giá trị (collection biến `NexusTheme`).

| Class Tailwind | CSS var | Giá trị | Dùng cho |
|---|---|---|---|
| `brand` | `--brand` | `#3155D9` | CTA chính, link, focus |
| `brand-hover` | `--brand-hover` | `#2745B8` | hover CTA |
| `brand-soft` | `--brand-soft` | `#EAF0FF` | nền section theo chủ đề, mục đang chọn |
| `ink` | `--ink` | `#0F172A` | tiêu đề, chữ chính |
| `body` | `--body` | `#334155` | đoạn văn |
| `muted` | `--muted` | `#5B6B82` | metadata |
| `canvas` | `--canvas` | `#F7F8FC` | nền app |
| `surface` | `--surface` | `#FFFFFF` | card, form, bảng |
| `line` | `--line` | `#DDE3EE` | viền, divider |
| `warm` | `--warm` | `#D97737` | nhấn tiết chế (icon, viền, chữ lớn) — **không** làm CTA thứ hai |
| `navy` | `--navy` | `#101C3A` | dải CTA, footer, form tư vấn ST01, sidebar Admin |
| `success` / `warning` / `danger` | | `#15803D` / `#B45309` / `#DC2626` | trạng thái |

`cta` và `primary` là alias của `brand` để mã cũ của storefront và `@nexus/ui` tiếp tục chạy.

### Độ tương phản (WCAG, đã tính)

| Cặp | Tỉ lệ |
|---|---|
| ink / canvas | 16.8 : 1 |
| body / surface | 10.4 : 1 |
| muted / canvas | 5.1 : 1 |
| muted / brand-soft | 4.8 : 1 |
| trắng / brand | 6.1 : 1 |
| trắng / navy | 16.8 : 1 |
| trắng / warm | 3.2 : 1 — chỉ dùng cho chữ lớn hoặc icon |

**Lệch so với spec:** spec ghi `--ink-muted #64748B`, nhưng màu này chỉ đạt 4.48 : 1 trên nền `canvas` (dưới ngưỡng AA 4.5). Đã đổi thành `#5B6B82` — màu gần nhất đạt chuẩn.

## 2. Chữ

Be Vietnam Pro qua `next/font/google` (subset `vietnamese`, `latin`; 400–800), gắn vào `--font-sans` ở layout của cả 3 app.

| Vai trò | Cỡ |
|---|---|
| H1 storefront | 28 (mobile) → 48 px |
| H1 portal/admin (`PageHeader`) | 24 → 28 px |
| H2 (`SectionHeader`) | 24 → 30 px |
| Chữ thường | 15–16 px |
| Nhãn, metadata | 13–14 px |

## 3. Class thành phần (trong preset)

`.container-site` (tối đa 1280 px), `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.card`, `.field-label`, `.field-input`, `.field-error`, `.field-hint`, `.eyebrow`, `.h1`, `.h2`, `.link`. Nút và ô nhập cao tối thiểu 44 px.

## 4. Component dùng chung (`@nexus/ui`)

| Component | Ghi chú |
|---|---|
| `PageHeader`, `Breadcrumbs` | H1 duy nhất của trang, hành động cùng hàng; truyền `next/link` qua `linkComponent` |
| `SectionHeader` | quy tắc "một chủ đề = một hàng": tiêu đề + mô tả trái, hành động phải |
| `SummaryStrip` | 2–4 ô cùng chủ đề trên một hàng; **không truyền con số API không trả về** |
| `DataTable`, `Pagination` | bảng full-width ở md+, chuyển thành thẻ xếp chồng dưới md; phân trang chỉ hiện tổng khi có `total` |
| `StatusBadge`, `Notice` | trạng thái luôn có ký hiệu (✓ ! ✕), không chỉ dựa vào màu |
| `EmptyState`, `ErrorState`, `Skeleton`, `LoadingBlock` | `LoadingBlock` có `role="status"` cho trình đọc màn hình |
| `ConfirmDialog`, `ResponsiveDrawer` | dựa trên `<dialog>` gốc: khóa focus, Escape để đóng, trả focus |
| `FormField`, `ErrorSummary` | tự gắn `aria-invalid` / `aria-describedby`; tóm tắt lỗi nhận focus sau khi gửi thất bại |
| `ToastProvider`, `useToast` | vùng `aria-live`; không đưa key, URL ký số hay token vào toast |
| `SystemPage` | thân chung cho SY01–SY03 |

## 5. Quy tắc bố cục

- Desktop: các nhóm cùng chủ đề xếp hàng ngang (grid 3–4 cột storefront, dải tóm tắt 3–4 ô portal, toolbar `search | filter | sort | CTA` admin).
- Mobile: lưới sản phẩm 2 cột, bảng chuyển thành thẻ, bộ lọc mở bằng `ResponsiveDrawer`; không cuộn ngang toàn trang.
- Mỗi màn demo/mô phỏng có nhãn **DỮ LIỆU MÔ PHỎNG**.
