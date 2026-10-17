# Checklist bàn giao file Figma — đối chiếu với code gốc

Phạm vi: file Figma "Hệ Thống Figma PGS" của dự án NexusTheme và phần code đã triển khai tương ứng (nhánh B2, PR #33).
Ngày lập: 2026-10-17. Nguồn đối chiếu: `packages/config/tailwind-preset.js`, `packages/ui/src/*`, `apps/web`, `docs/frontend/*`.

> **Giới hạn của bản đối chiếu này.** Chỉ đọc **code và tài liệu trong repo**. Nội dung bên trong file Figma (số trang, số frame, link prototype, quyền truy cập)
> **không kiểm chứng được từ code**; những mục đó ghi là "Cần xác nhận trong Figma". Chỉ ST01 (trang chủ) và SY01–SY03 (403/404/500) đã được triển khai
> và nghiệm thu; 46 màn còn lại chưa có code nên chưa có gì để đối chiếu.

Ký hiệu trạng thái: **Đạt** · **Một phần** · **Thiếu** · **Cần xác nhận trong Figma**.

| STT | Hạng mục | Mức độ | Trạng thái | Bằng chứng trong code / tài liệu | Còn thiếu để bàn giao |
|---|---|---|---|---|---|
| 1 | Cover dự án | Bắt buộc | **Thiếu** | Không có tên phiên bản thiết kế hay ngày bàn giao trong repo. `Logo` là logo NexusTheme (`apps/web/app/components/logo.tsx`), không phải logo khách hàng | Trang Cover: tên dự án, logo khách (nếu bàn giao cho khách ngoài), phiên bản (vd `v1.0`), ngày bàn giao |
| 2 | Sitemap | Bắt buộc | **Một phần** | `docs/frontend/route-audit.md` và `screen-registry.md` liệt kê 50 màn, route đích, app và batch | Chưa có sơ đồ trực quan và luồng điều hướng; có thể vẽ từ `screen-registry.md` |
| 3 | UI Desktop | Bắt buộc | **Một phần** | ST01 đã code và nghiệm thu mức REVIEW (`st01-acceptance.md`), ảnh `screenshots/ST01-desktop-1440.jpg`; SY01–03 có code. `progress.md` ghi "Figma xong" cho ST01, SY01–03 | 46 màn còn lại (ST02–ST13, PT01–PT14, AD01–AD20) chưa triển khai (B3–B7 "Chưa bắt đầu"); không biết trong Figma đã có frame chưa |
| 4 | UI Tablet | Theo hợp đồng | **Một phần** | Ảnh ST01 ở 768 px (`ST01-tablet-768.jpg`); Tailwind breakpoints mặc định | Chỉ ST01. Kiểm tra hợp đồng có yêu cầu tablet cho các màn khác không |
| 5 | UI Mobile | Bắt buộc nếu có trong phạm vi | **Một phần** | Ảnh ST01 ở 390 px (`ST01-mobile-390.jpg`); bảng chuyển thành thẻ dưới `md`, lưới sản phẩm 2 cột (`design-system.md` §5) | Chỉ ST01 và trang hệ thống |
| 6 | Design System | Bắt buộc | **Đạt** (màu, chữ, bo góc, đổ bóng; còn thiếu bảng spacing và grid) | 12 token màu + trạng thái, độ tương phản WCAG đã tính, Be Vietnam Pro, `rounded-xl/2xl`, `shadow-card/lift`, `container-site` 1280 px (`tailwind-preset.js`, `design-system.md` §1–3) | Thang spacing dùng mặc định của Tailwind nên chưa được ghi thành bảng riêng; chưa mô tả lưới cột. Cần đối chiếu collection biến `NexusTheme` trong Figma với preset |
| 7 | Components | Bắt buộc | **Đạt** (phần đã code) | `packages/ui/src`: Button/Card/Badge, `FormField`, `DataTable`, `Dialog`, `Toast`, `States`, `SystemPage`; header/footer ở `apps/web/app/components`; `design-system.md` §3–4 | Chưa có trang tổng hợp component (kiểu Storybook) để khách xem; cần xác nhận Figma có trang Components tương ứng |
| 8 | Component Variants | Bắt buộc với UI tương tác | **Một phần** | `.btn` có hover/disabled, `:focus-visible` toàn cục, `aria-invalid` cho ô nhập, `StatusBadge` có ký hiệu ✓ ! ✕; trạng thái loading ở form (`Loader2`). Ảnh `state-card-hover`, `state-tab-focus`, `state-skip-link` | Chưa có bảng đầy đủ default/hover/active/disabled/error/loading cho từng component; trạng thái `active` chưa ghi |
| 9 | Prototype | Bắt buộc nếu hợp đồng có UX/prototype | **Cần xác nhận trong Figma** | `design-system.md` nhắc trang `01 · Demo — Luồng tương tác`. Code: chế độ mô phỏng B7 "Chưa bắt đầu" | Xác nhận prototype có link đủ luồng chính (sản phẩm → giỏ → thanh toán → đơn → license → tải file); hiện chỉ ST01 có code thật |
| 10 | Asset Library | Bắt buộc | **Một phần** | Icon dùng `lucide-react` (nguồn mở); ảnh sản phẩm lấy từ API; ảnh tham chiếu `docs/frontend/references/ST01-homepage.png` | Không có thư mục tài nguyên xuất sẵn (logo, illustration) và không có ghi chú nguồn/giấy phép ảnh. Không có file `.fig` hay tài nguyên Figma trong repo |
| 11 | Responsive Rules | Bắt buộc | **Một phần** | `design-system.md` §5 (desktop xếp hàng ngang, mobile 2 cột, bảng→thẻ, bộ lọc→drawer); ST01 đã kiểm ở 1024/1280/1366/1440/1536/1920 px (E2E) | Chưa có bảng breakpoint chính thức (đang dùng mặc định 640/768/1024/1280/1536) và quy tắc co giãn cho từng khối |
| 12 | Developer Handoff | Bắt buộc | **Đạt** (cho ST01) | Token và class có tài liệu; ảnh đối chiếu Figma–code từng khối (`screenshots/st01-review/figma-vs-code-*.jpg`); `st01-acceptance.md` ghi cả chỗ lệch có chủ đích (vd `--muted` đổi để đạt WCAG AA) | Các màn khác chưa có |
| 13 | Content & Data | Theo phạm vi | **Một phần** | Nội dung tiếng Việt nằm trong code; dữ liệu mẫu cho E2E ở `apps/e2e/fixtures/seed-storefront-demo.mjs`; quy tắc dữ liệu động (giá, danh mục lấy từ API, trạng thái rỗng/lỗi) trong `st01-acceptance.md` | Chưa có bản nội dung đã duyệt tách riêng; **chính sách quyền riêng tư chưa có** (form tư vấn cần `PRIVACY_POLICY_URL`) |
| 14 | UI States | Bắt buộc khi áp dụng | **Đạt** (ST01 + trang hệ thống) | `EmptyState`, `ErrorState`, `Skeleton`, `LoadingBlock`, `Notice`, `ConfirmDialog`, `ErrorSummary`; ST01 có trạng thái lỗi API, rỗng, form lỗi theo trường, thành công có mã `SI-…`; SY01 403, SY02 404, SY03 500 | Trạng thái cho các màn chưa triển khai |
| 15 | Hướng dẫn sử dụng | Nên có | **Một phần** | `docs/frontend/*.md` (design system, registry, kế hoạch, nghiệm thu); `apps/e2e/README.md` | Chưa có README mô tả cấu trúc file Figma, quy ước đặt tên layer/component, cách đồng bộ token Figma ↔ code |
| 16 | Phân quyền | Bắt buộc | **Cần xác nhận trong Figma** | Không liên quan tới code | Cấp quyền xem/chỉnh sửa cho khách theo hợp đồng; kiểm tra link chia sẻ |
| 17 | Bản lưu trữ | Nên có | **Thiếu** | Không có file `.fig` trong repo (`git ls-files "*.fig"` = 0) | Xuất bản sao `.fig` theo phiên bản bàn giao và lưu kèm checksum nếu hợp đồng yêu cầu |
| 18 | Nghiệm thu | Bắt buộc | **Một phần** | `st01-acceptance.md`: ST01 ở trạng thái REVIEW, **chưa Approved**, liệt kê chỗ lệch và hạng mục tồn đọng; `progress.md` theo dõi từng batch | Biên bản xác nhận phiên bản cuối, phạm vi hoàn thành và danh sách tồn đọng có chữ ký/đồng ý của khách; mới có 1 màn đạt mức review |

## Tóm tắt

| Kết quả | Số hạng mục | Mục |
|---|---|---|
| Đạt (trong phạm vi đã triển khai) | 4 | 6, 7, 12, 14 |
| Một phần | 10 | 2, 3, 4, 5, 8, 10, 11, 13, 15, 18 |
| Thiếu | 2 | 1, 17 |
| Cần xác nhận trong Figma | 2 | 9, 16 |
**Kết luận:** chưa thể bàn giao toàn bộ cho khách. Bộ nền tảng (token, component, trạng thái, tài liệu dev) và trang ST01 + 403/404/500 đã đủ chuẩn để bàn giao theo từng phần; còn thiếu cover, bản `.fig` lưu trữ, tài liệu dùng file, phân quyền, prototype cần xác nhận, và 46 màn chưa làm.

## Việc cần làm trước khi bàn giao (theo thứ tự)

1. Tạo trang Cover và đánh số phiên bản.
2. Xác nhận trong Figma: các trang Components, Prototype, quyền truy cập; xuất bản sao `.fig`.
3. Viết README cho file Figma (cấu trúc trang, quy ước tên, đồng bộ token).
4. Vẽ Sitemap từ `screen-registry.md`.
5. Bổ sung bảng breakpoint và bảng variants cho từng component.
6. Hoàn thiện chính sách quyền riêng tư và bản nội dung đã duyệt.
7. Lập biên bản nghiệm thu phiên bản cuối cùng cùng khách hàng.
