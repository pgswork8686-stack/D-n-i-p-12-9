# ST01 — ghi chú bố cục từ ảnh Stitch

Nguồn: `ST01-homepage.png` (chủ dự án cung cấp 12/10/2026, bản chụp toàn trang **374×2048 px** — đọc được hình khối, thứ tự section, màu; **không đọc được chữ nhỏ**). Cần bản gốc độ phân giải cao (≥1440 px rộng) để đối chiếu khoảng cách và cỡ chữ ở B2.

Chỉ dùng ảnh để tham khảo bố cục. Tên sản phẩm, giá, số lượng ("32 Plugins", "40 Theme"…) trong ảnh là minh họa — khi code phải lấy từ API hoặc bỏ đi.

| # | Section | Bố cục quan sát được | Nguồn dữ liệu khi code |
|---|---|---|---|
| R1 | Header | Logo trái · menu ngang (Sản phẩm ▾, Themes, Plugins, Web App, Mobile App, Chatbot AI, UI Kits, Blog) · giỏ hàng có badge · nút "Tài khoản" | Mục menu sản phẩm lấy từ `GET /categories`, không hardcode |
| R2 | Hero | Pill eyebrow · H1 căn giữa 2 dòng, cụm cuối màu brand · mô tả · thanh tìm kiếm có select danh mục + nút "Tìm kiếm" · hàng tag gợi ý | Search → `/products?search=` |
| R2b | Showcase | Trái ~60%: card "Featured Theme" lớn (ảnh mockup, tên, giá, CTA) · Phải ~40%: "Top tài nguyên tuyển chọn" — list 4 dòng (tag loại, tên, mô tả, giá, link) | `GET /products` (không có cờ "featured" trong API → dùng sort hiện có, ghi rõ) |
| R3–R4 | Sản phẩm nổi bật | Tiêu đề trái + sort phải · hàng tab danh mục ngang · grid 3 cột × 2 hàng (ảnh, nhãn loại, tên, mô tả, giá, "Xem chi tiết") | `GET /products?category=` |
| R5 | Chọn theme WP | Nền `#EAF0FF` · tiêu đề giữa · hàng chip nhu cầu (4 chip) · gallery 2×2 ảnh lớn có caption phủ dưới · link "Xem toàn bộ … →" | Danh mục con WordPress từ API; số lượng chỉ khi có `total` |
| R6 | Plugins & UI Kits | 2 cột song song, mỗi cột: icon + tiêu đề + mô tả + list 4 mục + nút "Khám phá …" | `GET /products` theo 2 danh mục |
| R7 | Quy trình | 3 bước ngang 01/02/03 (Chọn sản phẩm · Thanh toán VietQR · Tải file & nhận license) | tĩnh |
| R8 | Form tư vấn | Nền navy `#101C3A` · tiêu đề "Chưa biết chọn theme nào?" · form 2 cột: Họ tên / Email · Loại website (select) / SĐT · textarea full-width · checkbox đồng ý · CTA full-width | **DEMO_ONLY** — không có API |
| R9 | Tin tức | Tiêu đề trái + link phải · 3 card ngang (ảnh, nhãn, ngày, tiêu đề, "Đọc bài viết") | `GET /content/posts?limit=3` |
| R10 | Footer | Nền navy · 4 cột: thương hiệu + mô tả · Khám phá · Hỗ trợ · Chính sách & tài khoản · thanh bản quyền | Link chính sách trỏ ST13 (demo tới khi có trang thật) |

So với `apps/web/app/page.tsx` hiện tại: thiếu R2b, R5, R6, R8; hero đang là split chữ trái / minh họa phải (spec cấm); có thêm section "Values" và CTA cuối không có trong thiết kế.
