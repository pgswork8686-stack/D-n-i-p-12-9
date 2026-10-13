# Đề xuất backend phát sinh từ ST01

Trạng thái: **ĐỀ XUẤT — chưa triển khai**. Không file nào trong `apps/api`, `apps/worker`, `packages/database` bị sửa. Mỗi mục cần chủ dự án duyệt trước khi mở PR backend riêng.

---

## P1. Sản phẩm nổi bật / sắp xếp thủ công (showcase ST01)

**Hiện trạng.** `GET /products` chỉ có `sort = newest | price_asc | price_desc | name_asc` và không có cờ nổi bật. ST01 vì vậy hiển thị "Mới phát hành" thay cho "Theme nổi bật".

**Hai phương án:**

| | A. Cờ trên `Product` | B. Bảng vị trí trưng bày (khuyến nghị) |
|---|---|---|
| Schema | `isFeatured Boolean @default(false)`, `featuredRank Int?` | bảng mới `product_placements(id, placement, product_id, sort_order, starts_at?, ends_at?, created_by)`, unique `(placement, product_id)` |
| Linh hoạt | một danh sách duy nhất | nhiều vị trí: `home_showcase`, `home_top_picks`, `category_banner:<slug>`…, có lịch bắt đầu/kết thúc |
| Ảnh hưởng | sửa bảng `products` (lõi catalog) | **thuần bổ sung**, không chạm `products` |
| API public | `GET /products?featured=true` | `GET /placements/:placement/products` (chỉ sản phẩm `ACTIVE`, giữ thứ tự `sort_order`) |
| API admin | `PATCH /admin/products/:id` | `GET/PUT /admin/placements/:placement` (thay cả danh sách, CAS theo `updatedAt`) |
| Quyền | `product.write` | `product.write` (hoặc quyền mới `merchandising.manage`) |

**Đánh giá ảnh hưởng (cả hai):** không đụng `Order`/`OrderItem` snapshot, entitlement hay giá; migration additive; cache public 60–300 s. Rủi ro chính là sản phẩm bị gỡ (`ARCHIVED`) vẫn nằm trong vị trí — endpoint public phải lọc `status = ACTIVE`.

**Frontend khi có API:** showcase đọc `home_showcase` (1 sản phẩm), danh sách bên phải đọc `home_top_picks`; khi vị trí rỗng → quay về "Mới phát hành" như hiện nay.

---

## P2. Quản lý ảnh sản phẩm qua Admin/API

**Hiện trạng.** Bảng `product_media` có sẵn (`type: IMAGE | GALLERY | PREVIEW | ICON | THUMBNAIL`, `url`, `storageKey`, `altText`, `sortOrder`). Danh sách public lấy `media` loại `THUMBNAIL` đầu tiên (`products.service.ts:659`). **Không có endpoint nào ghi bảng này** — ảnh chỉ vào được bằng SQL.

**Đề xuất:**

| Endpoint | Quyền | Ghi chú |
|---|---|---|
| `POST /admin/products/:id/media` (multipart `file`, `type`, `altText`) | `product.write` | dùng lại cơ chế upload của `admin-versions.controller.ts` (Multer + giới hạn dung lượng, máy chủ tự sinh `storageKey`) |
| `PATCH /admin/products/:id/media/:mediaId` | `product.write` | đổi `altText`, `type`, `sortOrder` |
| `PUT /admin/products/:id/media/order` | `product.write` | sắp lại thứ tự cả bộ |
| `DELETE /admin/products/:id/media/:mediaId` | `product.write` | xóa object storage sau khi xóa dòng (dọn file mồ côi như Phase 8) |

**Ràng buộc bắt buộc:**
- **Bucket ảnh public tách khỏi bucket file tải xuống private.** Ảnh catalog cần URL công khai qua CDN; file ZIP/license vẫn chỉ qua URL ký số. Không bao giờ dùng chung bucket.
- Kiểm tra MIME thật (đọc magic bytes), chỉ `image/jpeg|png|webp|avif`; tối đa ~5 MB; từ chối SVG (rủi ro XSS).
- Sinh biến thể kích thước (vd. 480/960/1600 px, WebP) ở worker qua outbox — API trả `202` và trạng thái `PROCESSING`.
- `altText` bắt buộc cho `THUMBNAIL`/`GALLERY` (a11y).
- Ghi `AuditLog` (`PRODUCT_MEDIA_ADDED/REMOVED`).
- Màn Admin tương ứng: tab "Media" trong AD04 (Figma đã có khối "Ảnh sản phẩm").

---

## P3. API nhận yêu cầu tư vấn (form ST01 R8)

**Hiện trạng.** Không có endpoint. Form đang `DEMO_ONLY`: kiểm tra dữ liệu ở trình duyệt, **không lưu, không gửi**, có nhãn "Mô phỏng".

**Đề xuất `POST /v1/leads` (public):**

| Trường | Ràng buộc |
|---|---|
| `name` | bắt buộc, 2–100 ký tự |
| `email` | bắt buộc, định dạng email |
| `phone` | tùy chọn, `^(\+84|0)\d{9,10}$` sau khi bỏ khoảng trắng |
| `websiteType` | enum cố định (khớp danh sách trên form) |
| `message` | tùy chọn, ≤ 2000 ký tự, lưu dạng text thuần |
| `consent` | **phải `true`**; lưu kèm `consentText` phiên bản và thời điểm |
| `sourcePath` | trang gửi (vd. `/`) |

**Chống spam:**
1. Giới hạn tần suất theo IP và theo email bằng Redis sliding window (cùng kiểu Lua script của Phase 8), vd. 3 yêu cầu/10 phút/IP; vượt → `429`.
2. Trường honeypot ẩn + thời gian điền tối thiểu (vd. ≥ 3 s) — vi phạm thì trả `202` giả để bot không dò được.
3. Tùy chọn Cloudflare Turnstile khi có dấu hiệu bị lạm dụng.
4. Chuẩn hóa và loại trùng: cùng email + nội dung trong 24 h → gộp.

**Lưu trữ & xử lý:** bảng mới `leads(id, name, email, phone, website_type, message, consent_at, consent_text_version, source_path, status NEW|CONTACTED|CLOSED|SPAM, ip_hash, created_at)` — IP chỉ lưu dạng hash. Sự kiện `LEAD_CREATED` qua outbox → n8n gửi email cho đội tư vấn (n8n không ghi DB). Admin xem/đổi trạng thái (quyền mới `lead.read`/`lead.manage`). Có chính sách giữ dữ liệu (vd. 12 tháng) theo quy định bảo vệ dữ liệu cá nhân.

**Phản hồi cho frontend:** `202 { status: "received", reference }` → form hiện "Đã nhận yêu cầu, mã tham chiếu …"; `400` → lỗi theo trường; `429` → "Bạn gửi quá nhanh, thử lại sau ít phút"; `5xx` → giữ nguyên dữ liệu đã nhập, cho thử lại. Khi API sẵn sàng thì bỏ nhãn "Mô phỏng".

---

## P4. Số tổng cho danh sách khách hàng (từ route-audit, nhắc lại)

`GET /orders`, `/entitlements`, `/licenses`, `/tickets` không trả `total` — ảnh hưởng PT01/PT08, không ảnh hưởng ST01.
