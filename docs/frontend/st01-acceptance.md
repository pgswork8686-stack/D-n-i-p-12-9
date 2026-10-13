# Nghiệm thu ST01 · Trang chủ — vòng 1

**Trạng thái: REVIEW — chờ chủ dự án duyệt.** Ngày 13/10/2026 · nhánh `feat/frontend-b2-st01`.

Đối chiếu là **so sánh trực quan cạnh nhau** (ảnh xuất từ Figma "Hệ Thống Figma PGS" frame `ST01 · Trang chủ` và ảnh chụp bản chạy thật ở 1440 px), không phải so pixel tự động. Không khẳng định pixel-perfect.

Môi trường chạy thật: stack cách ly trong Docker (Postgres + Redis tạm, API `NODE_ENV=development`, web `next dev`), dữ liệu demo tạo qua Admin API bằng `apps/e2e/fixtures/seed-storefront-demo.mjs` (11 danh mục, 16 sản phẩm thương hiệu "Sản phẩm demo", 3 bài viết). Trình duyệt: Chromium (Playwright 1.48).

## 1. Ảnh chụp

| Ảnh | File |
|---|---|
| Toàn trang 1440 / 768 / 390 | `screenshots/ST01-desktop-1440.jpg`, `ST01-tablet-768.jpg`, `ST01-mobile-390.jpg` |
| Form tư vấn sau khi gửi hợp lệ | `screenshots/ST01-consult-form-demo.jpg` |
| Figma ↔ code từng khu (11 khu) | `screenshots/st01-review/figma-vs-code-*.jpg` |
| Trạng thái hover thẻ, link "Bỏ qua tới nội dung", focus tab | `screenshots/st01-review/state-*.jpg` |

## 2. Figma ↔ Implementation

| Khu | Figma | Code | Kết luận |
|---|---|---|---|
| Header | Logo · "Sản phẩm ▾" · 7 nhóm · Blog · tìm kiếm · giỏ · Tài khoản | Logo · menu "Sản phẩm ▾" chứa **mọi** nhóm · 5 nhóm hiện ngang · Blog · tìm kiếm · giỏ · Đăng nhập/Tài khoản | Lệch có lý do (D1) |
| R2 Hero | pill · H1 2 dòng (nửa sau màu brand) · mô tả · thanh tìm kiếm + chọn danh mục · chip phổ biến | giống; chip phổ biến là danh mục thật | Khớp; D2 |
| R2b Showcase | "Theme nổi bật 2026" + giá + gói license · "Top tài nguyên" 4 dòng | "Mới phát hành" (sản phẩm mới nhất) + giá · "Vừa cập nhật" 4 dòng | Lệch do thiếu API (D3) |
| R3–R4 Lưới | tiêu đề + **sắp xếp** · tab 8 nhóm · lưới 3×2, thẻ: nhóm · tên · mô tả · giá · "Xem chi tiết" | tiêu đề + "Xem tất cả" · tab theo API · lưới 3×2 (2 cột mobile), thẻ cùng cấu trúc | Khớp; D4 |
| R5 WordPress | nền `#EAF0FF` · chip nhu cầu · gallery 2×2 có chú thích · link "Xem toàn bộ" | giống; chú thích có thêm giá; số "5 sản phẩm" lấy từ `total` | Khớp |
| R6 Plugins & UI Kits | 2 cột, mỗi mục ✓ + mô tả | 2 cột, mỗi mục tên + giá thật | Khớp; D5 |
| R6b Web/Mobile/Chatbot | 3 cột có **ảnh bìa** + nhãn nhóm · "Xem tất cả giải pháp" | giống (ảnh bìa = ảnh sản phẩm mới nhất của nhóm) | Khớp |
| R7 Quy trình | 3 bước, số 01–03 màu rất nhạt | giống; số đậm hơn để đạt tương phản | Khớp; D6 |
| R8 Form tư vấn | nền navy · form 2 cột · ghi chú "Mô phỏng" màu cam | giống; có kiểm tra lỗi theo trường | Khớp |
| R9 Tin tức | 3 thẻ ngang | 3 thẻ từ CMS (chỉ bài PUBLISHED) | Khớp |
| R10 Footer | 4 cột, cột 4 "Chính sách & tài khoản" | 4 cột, cột 4 "Tài khoản" (không link chính sách) | Lệch có lý do (D7) |

### Các điểm lệch được giữ lại (cần chủ dự án chấp nhận)

| # | Lệch | Lý do |
|---|---|---|
| D1 | Header hiện 5 nhóm ngang + menu "Sản phẩm" chứa đủ, thay vì 7 nhóm ngang | Tên nhóm thật ("Theme WordPress", "UI Kits & Figma", "Next.js / React") dài hơn nhãn Figma ("Themes", "UI Kits"). Đo thật ở 1440: menu cần 892 px, chỉ có 807 px. Khung trang tối đa 1280 px nên màn rộng hơn không có thêm chỗ. Đã kiểm tra không cắt/không tràn ở 1024–1920 px |
| D2 | Chip "Phổ biến" là danh mục, không phải từ khóa ("Theme bán hàng"…) | Không có API từ khóa tìm kiếm phổ biến; không hardcode |
| D3 | Showcase "Mới phát hành" thay "Theme nổi bật"; không có dòng gói license | API không có cờ nổi bật (đề xuất P1) và danh sách không trả thông tin gói |
| D4 | Không có ô "Sắp xếp" trên lưới trang chủ | Sắp xếp thuộc trang danh mục ST02; trang chủ có "Xem tất cả" |
| D5 | Mục Plugins/UI Kits hiện giá thay vì ✓ + mô tả | Dữ liệu thật hữu ích hơn mô tả tĩnh |
| D6 | Số 01–03 màu `#8794AB` thay màu viền | Màu Figma ~1.3 : 1, axe báo lỗi; `#8794AB` là màu nhạt nhất đạt 3 : 1 cho chữ lớn |
| D7 | Footer không có link chính sách | ST13 chưa có nội dung pháp lý được duyệt — không link tới trang không có thật |

## 3. Danh sách vấn đề

| # | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| M1 | Major | Thẻ sản phẩm khác Figma: nhãn trên tên là thương hiệu thay vì nhóm, nhãn loại đè lên ảnh, không có "Xem chi tiết"; ở mobile 2 cột nhãn che nửa ảnh, không có CTA | **Đã sửa** |
| M2 | Major | Header 1440 chỉ hiện 5/7 nhóm; khi hiện đủ thì **đẩy nút Đăng nhập ra ngoài màn 30 px**, sau đó lớp chống tràn **cắt mất "Blog"** (link ẩn vẫn nhận focus); ở ≥1536 px menu bị cắt 227 px | **Đã sửa** (menu "Sản phẩm" + 5 nhóm ngang, test quét 6 độ rộng) |
| M3 | Major | API lỗi bị hiển thị thành "Cửa hàng đang cập nhật sản phẩm" (lỗi bị nuốt thành danh sách rỗng) | **Đã sửa** — trạng thái lỗi riêng có "Thử lại" |
| M4 | Major | axe (serious) — tương phản: nhãn "Mới phát hành" (màu `warm` 3.2 : 1) và số 01–03 (~1.3 : 1) | **Đã sửa** |
| M5 | Major | Khu Web/Mobile/Chatbot thiếu ảnh bìa và link "Xem tất cả giải pháp" | **Đã sửa** |
| m1 | Minor | Form tư vấn không có placeholder; ghi chú "Mô phỏng" chỉ hiện sau khi gửi | **Đã sửa** — ghi chú cam hiện thường trực |
| m2 | Minor | Khoảng trống lớn giữa Tin tức và footer | **Đã sửa** |
| m3 | Minor | Ảnh demo đầu tiên không hiện (seed dùng loại `IMAGE`, danh sách chỉ đọc `THUMBNAIL`; ảnh chatbot sai đuôi) | **Đã sửa** trong script seed |
| — | Critical | Không phát hiện | — |

Còn mở / chưa kiểm tra:

| # | Mức | Nội dung |
|---|---|---|
| O1 | Major (ra mắt) | **Không có API quản lý ảnh sản phẩm** → trên production, mọi thẻ sẽ là hình thay thế. Không chặn duyệt code ST01 nhưng chặn ra mắt storefront (đề xuất P2) |
| O2 | ~~Quyết định~~ **Đã xử lý (vòng 2)** | Chủ dự án quyết định production không hiển thị form mô phỏng → cờ `FEATURE_CONSULT_FORM_DEMO` (xem §8) |
| O3 | Chưa test | Safari/Firefox, thiết bị thật, Lighthouse/Core Web Vitals |
| O4 | Minor | Ảnh dùng `<img>` (không phải `next/image`); thẻ sản phẩm có `width/height` và khung tỉ lệ cố định nên không gây CLS, nhưng chưa có ảnh responsive nhiều kích thước (phụ thuộc P2) |

## 4. Đã sửa — bằng chứng

| Sửa | File | Bằng chứng |
|---|---|---|
| Thẻ sản phẩm theo Figma, mobile đủ ảnh/tên/giá/CTA | `apps/web/app/components/product-card.tsx` | E2E "product cards show image, name, price and CTA at every width" (3 kích thước); `figma-vs-code-latest.jpg` |
| Header: menu "Sản phẩm" chứa mọi nhóm, 5 nhóm ngang, không cắt | `apps/web/app/components/site-header.tsx` | E2E "header nav is never clipped… 1024–1920px", "'Sản phẩm' menu lists every category group and closes with Escape" |
| Trạng thái lỗi khi API lỗi | `apps/web/app/lib/server-api.ts` (`tryListProducts`), `apps/web/app/page.tsx` | Unit "shows an error state, not an empty catalog, when the product API fails" |
| Tương phản AA | `apps/web/app/page.tsx` | E2E axe: 0 vi phạm serious/critical ở 3 kích thước |
| Ảnh bìa R6b + link | `apps/web/app/page.tsx` | `figma-vs-code-solutions.jpg` |
| Form: placeholder, ghi chú thường trực | `apps/web/app/components/consult-form.tsx` | E2E "consultation form validates and never sends a request"; unit "always labels the consultation form as a simulation" |

## 5. Chưa hoàn thiện do thiếu backend

| Chức năng | Hiện tại | Cần | Đề xuất |
|---|---|---|---|
| Sản phẩm nổi bật | hiện sản phẩm mới nhất, nhãn "Mới phát hành" | vị trí trưng bày quản lý từ Admin | `backend-proposals.md` P1 |
| Ảnh sản phẩm | chỉ đọc được; ghi bằng SQL ở DB tạm | upload/sắp xếp/xóa qua Admin | P2 |
| Form tư vấn | kiểm tra dữ liệu, **không gửi, không lưu**, có nhãn "Mô phỏng" | `POST /v1/leads` + chống spam + thông báo | P3 |
| Gói license trên showcase | không hiển thị | danh sách trả thông tin gói rẻ nhất | gộp vào P1 |

**Dữ liệu demo và production:** dữ liệu demo chỉ tồn tại trong DB tạm của container; script seed từ chối chạy khi `NODE_ENV=production` hoặc API không phải localhost/host khai báo; mọi sản phẩm demo có thương hiệu "Sản phẩm demo"; dev token chỉ hoạt động khi API không ở production; SQL ảnh demo không tự chạy. Code ST01 **không có nhánh demo** — chỉ form tư vấn mang nhãn mô phỏng vì thiếu API.

## 6. Báo cáo test

| Lệnh | Nơi chạy | Kết quả |
|---|---|---|
| `pnpm --filter @nexus/web run lint` | host | 0 lỗi, 0 cảnh báo |
| `pnpm --filter @nexus/web run typecheck` | host | đạt |
| `pnpm --filter @nexus/web run test` | host | **30/30** (12 SEO cũ, 12 logic trang chủ, 6 trạng thái trang chủ) |
| `pnpm --filter @nexus/e2e test:e2e` | container `mcr.microsoft.com/playwright:v1.48.0-jammy` | **35 đạt · 0 trượt · 4 bỏ qua có chủ đích** (2 test chỉ dành cho desktop) |
| CI đầy đủ theo `ci.yml`: `install --frozen-lockfile` → `db:generate/migrate/seed:local` → `lint` → `typecheck` → `test` → `build` | container `node:22-bookworm` + Postgres 16 + Redis 7 tạm | lint 11/11 · typecheck 17/17 · test 17/17 (**752 test**) · build 11/11 |

E2E theo từng kích thước:

| Test | 1440 | 768 | 390 |
|---|---|---|---|
| 1 `h1`, đủ khu đúng thứ tự Figma | ✓ | ✓ | ✓ |
| Không cuộn ngang | ✓ | ✓ | ✓ |
| Không lỗi console, không ảnh lỗi | ✓ | ✓ | ✓ |
| Tìm kiếm hero → API → thấy sản phẩm | ✓ | ✓ | ✓ |
| Lọc danh mục từ hero | ✓ | ✓ | ✓ |
| Tab danh mục từ API, đúng thứ tự admin, mở danh sách lọc | ✓ | ✓ | ✓ |
| Thẻ → trang chi tiết (h1 = tên sản phẩm) | ✓ | ✓ | ✓ |
| Thẻ đủ ảnh/tên/giá/CTA, rộng ≥ 150 px | ✓ | ✓ | ✓ |
| Form: 3 lỗi, focus vào tóm tắt lỗi, SĐT sai, không có request ghi | ✓ | ✓ | ✓ |
| Bàn phím: link bỏ qua đầu tiên, có viền focus | ✓ | ✓ | ✓ |
| axe WCAG 2.1 A/AA: 0 serious/critical | ✓ | ✓ | ✓ |
| Menu "Sản phẩm" đủ nhóm, Esc đóng & trả focus | ✓ | — | — |
| Header không cắt, trang không tràn (1024→1920) | ✓ | — | — |

Kiểm tra thủ công: đổi tên danh mục "Web App" qua Admin API → trang chủ tải lại hiển thị tên mới ở tab, ô chọn, menu và footer (10 vị trí); đã đổi lại. Trên production header/footer cập nhật trong ≤ 5 phút (cache `revalidate: 300`).

Trạng thái rỗng/lỗi kiểm tra ở tầng render (`home-page-states.spec.tsx`) vì E2E không điều khiển dữ liệu phía server.

## 7. Đề xuất điều kiện duyệt ST01

1. Chủ dự án xem `screenshots/` và chấp nhận các điểm lệch **D1–D7** (hoặc chỉ định sửa).
2. Quyết định **O2**: form tư vấn ở production — ẩn đến khi có P3, hay giữ nhãn "Mô phỏng".
3. CI GitHub (`ci.yml`) xanh trên PR của nhánh này.
4. Bộ E2E `apps/e2e` đạt trên môi trường staging có dữ liệu demo.
5. Ghi nhận **O1** (API media) là điều kiện **ra mắt** storefront, không phải điều kiện duyệt code ST01.

Khi đủ 1–4: ST01 chuyển "Approved" trong `progress.md` và mới bắt đầu B3.

---

## 8. Vòng xác nhận cuối (vòng 2) — 13/10/2026

**Trạng thái: vẫn REVIEW.** Không tự đánh dấu Approved.

### 8.1. D1–D7 — đề xuất nghiệm thu

| # | Khác Figma | Lý do | Ảnh đối chiếu | Khuyến nghị |
|---|---|---|---|---|
| D1 | Header: 5 nhóm hiện ngang + nút "Sản phẩm ▾" mở menu chứa **đủ** nhóm; Figma hiện 7 nhóm ngang | Tên nhóm thật dài hơn nhãn Figma ("Theme WordPress" vs "Themes"). Đo: cần 892 px, chỉ có 807 px; khung trang cố định 1280 px nên màn rộng hơn không thêm chỗ. Mọi nhóm vẫn truy cập được, không link nào bị cắt hay ẩn mà còn nhận focus | `st01-review/figma-vs-code-header.jpg` | **Giữ.** Nếu muốn đủ 7 nhóm ngang: thêm trường "nhãn menu ngắn" cho danh mục ở Admin (việc backend nhỏ, chưa có trong backlog) |
| D2 | Chip "Phổ biến" ở hero là tên danh mục; Figma là từ khóa ("Theme bán hàng", "App đặt lịch"…) | Không có dữ liệu từ khóa tìm kiếm phổ biến; không hardcode từ khóa | `st01-review/figma-vs-code-hero.jpg` | **Giữ** đến khi có thống kê tìm kiếm |
| D3 | Showcase "Mới phát hành" + "Vừa cập nhật"; Figma "Theme nổi bật 2026" + "Top tài nguyên" + dòng gói license | API không có cờ nổi bật; danh sách không trả thông tin gói | `st01-review/figma-vs-code-showcase.jpg` | **Giữ tạm**, sửa khi xong BL-2 (P1) |
| D4 | Lưới sản phẩm không có ô "Sắp xếp" | Sắp xếp thuộc trang danh mục ST02; trang chủ có "Xem tất cả" | `st01-review/figma-vs-code-latest.jpg` | **Giữ** |
| D5 | Plugins/UI Kits: mỗi dòng là tên + giá thật; Figma là ✓ + mô tả | Dữ liệu thật hữu ích hơn mô tả tĩnh | `st01-review/figma-vs-code-tools.jpg` | **Giữ** |
| D6 | Số 01–03 ở "Quy trình" màu `#8794AB`; Figma nhạt hơn | Màu Figma ~1.3 : 1, axe báo lỗi tương phản; `#8794AB` là màu nhạt nhất đạt 3 : 1 cho chữ lớn | `st01-review/figma-vs-code-steps.jpg` | **Giữ** (yêu cầu accessibility) |
| D7 | Footer không có link chính sách; Figma có cột "Chính sách & tài khoản" | ST13 chưa có nội dung pháp lý được duyệt, không có trang thật để link | `st01-review/figma-vs-code-footer.jpg` | **Giữ** đến khi có BL-5 |

Đề xuất: **chấp nhận D1–D7 như trên**; không điểm nào cần sửa code trước khi duyệt.

### 8.2. Form tư vấn trên production — `FEATURE_CONSULT_FORM_DEMO`

| Giá trị | Hiển thị | Dùng ở |
|---|---|---|
| không đặt / khác `true` (mặc định) | **Không có form mô phỏng.** Khối R8 hiện CTA "Gửi yêu cầu tư vấn" → `PORTAL/tickets` (kênh hỗ trợ có thật) + "Tự xem sản phẩm" | **Production** |
| `true` | Form demo, có kiểm tra lỗi, nhãn "Mô phỏng" thường trực, không gửi/không lưu | Dev, staging khi cần demo |

Cờ đọc phía server lúc chạy (không phải `NEXT_PUBLIC_`), vì staging cũng chạy `NODE_ENV=production`. Đã thêm vào `infra/docker/production-compose.yml` (mặc định `false`), `.env.production.example`, `docs/deployment/environment-matrix.md`. Ảnh: `screenshots/ST01-consult-cta-production.jpg`.

### 8.3. E2E trên staging gần production

Cấu hình: web `next build` + `next start` (`NODE_ENV=production`), API `NODE_ENV=production` (Supabase, R2, SePay cấu hình kiểu staging — fail-closed thật), Postgres/Redis riêng, HTTPS qua Caddy (`web.staging.test`, `api.staging.test`, `img.staging.test`, chứng chỉ nội bộ), `FEATURE_CONSULT_FORM_DEMO` không đặt. Dữ liệu demo tạo qua Admin API trong lần khởi động development, sau đó API khởi động lại ở production và **từ chối dev token (401)** — đã kiểm tra tự động trong script dựng staging.

| Lượt | Môi trường | Kết quả |
|---|---|---|
| Staging (cấu hình production) | `E2E_CONSULT_MODE=cta` | **35 đạt · 0 trượt · 7 bỏ qua** |
| Dev (`FEATURE_CONSULT_FORM_DEMO=true`) | `E2E_CONSULT_MODE=demo` | **35 đạt · 0 trượt · 7 bỏ qua** |

Test bị bỏ qua trên staging và lý do:

| Test | Kích thước | Lý do |
|---|---|---|
| Form tư vấn mô phỏng: kiểm tra lỗi, không gửi request | 1440, 768, 390 | Form mô phỏng tắt — đúng cấu hình production. Đã chạy và đạt ở lượt Dev |
| Menu "Sản phẩm" đủ nhóm, Esc đóng | 768, 390 | Menu ngang chỉ có từ 1024 px; đã chạy và đạt ở 1440 |
| Header không cắt, trang không tràn 1024–1920 px | 768, 390 | Test tự quét các độ rộng desktop; đã chạy và đạt ở 1440 |

Gộp hai lượt: **mọi test đều đã chạy và đạt ít nhất một lần ở chế độ áp dụng**. Test "chế độ production: không có form mô phỏng, CTA tới kênh thật" đạt ở cả 3 kích thước trên staging.

### 8.4. CI và PR

| Mục | Trạng thái |
|---|---|
| CI cục bộ sạch (không chép `.env` local) theo `ci.yml` | lint 11/11 · typecheck 17/17 · test 17/17 (**754 test**) · build 11/11 |
| Phát hiện trong vòng này | Các lần chạy CI cục bộ trước có chép file `.env` local vào container; lần chạy sạch cho cùng kết quả nên không có lỗi bị che. Script đã loại `.env*` |
| PR GitHub | **Chưa tạo được** — token của `gh` cho `pgswork8686-stack` đã hết hiệu lực, phiên làm việc không có connector GitHub |
| GitHub CI | **Chưa xác nhận được** (chưa có PR) |

### 8.5. Release blockers còn lại (Storefront)

| # | Blocker | Theo dõi |
|---|---|---|
| 1 | API quản lý ảnh sản phẩm | `backlog.md` BL-1 (P2) |
| 2 | CI GitHub xanh trên PR của nhánh | chờ cấp lại quyền GitHub CLI |
