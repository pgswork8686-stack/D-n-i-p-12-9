# PGS — bộ mẫu thu thập dữ liệu trước khi có VPS

Các file `*.template.json` là **mẫu trống**, không phải sản phẩm, dịch vụ hay bài viết được phép xuất bản. Mặc định tất cả là `DRAFT`; không seed vào production.

## Quy trình nhập dữ liệu

1. Sao chép các mẫu sang tệp nội bộ được bảo vệ; người phụ trách nội dung điền từ báo giá, giấy phép, thiết kế, thông tin pháp lý đã duyệt. **Không gửi khóa API, dữ liệu khách hàng hoặc mật khẩu vào Git.**
2. Các ảnh, gallery phải có nguồn/giấy phép sử dụng; mỗi ảnh cần alt text mô tả chính xác, không nhồi từ khóa.
3. Sản phẩm: một SKU/variant cần tên, mã SKU, giá VND theo đơn vị đồng, loại license, điều kiện hỗ trợ/cập nhật, đường dẫn file có quyền phân phối. Giá và thông tin sở hữu chưa có => giữ DRAFT.
4. Dịch vụ: định nghĩa phạm vi, deliverables, quy trình, thời gian tham khảo chỉ khi có cam kết được duyệt. 6 dịch vụ seed hiện tại là nháp, không coi là thông tin thương mại đã phê duyệt.
5. Bài viết: tiêu đề, slug, nội dung gốc, tác giả, ảnh được phép dùng, metadata, liên kết nội bộ. Không tạo lời chứng thực khách hàng không có thật.
6. Chỉ chuyển trạng thái `ACTIVE` sau khi đối chiếu giá, tác quyền, chính sách và chức năng Admin/API thực tế.

## Kiểm tra kỹ thuật

```bash
node scripts/validate-content-intake.mjs
```

CI kiểm tra cú pháp và các trường quan trọng trước khi nhập. Validator **không** kiểm tra file ảnh có thật, không phát hiện hết vi phạm bản quyền, không truy cập mạng, không nhập DB và không xác nhận số tiền ngân hàng; vẫn bắt buộc người kiểm duyệt.

### Các trường dữ liệu

- `products.template.json`: sản phẩm số và các variant (dự kiến `{sku,name,amountVnd}`), chính sách license và hỗ trợ, hình ảnh, quyền phân phối.
- `services.template.json`: dịch vụ báo giá, mục tiêu, tính năng, phạm vi bàn giao, các bước triển khai, chính sách riêng tư.
- `articles.template.json`: bài blog/CMS, nội dung SEO, ảnh/alt, tác giả và internal links.

Các mẫu không thay thế hợp đồng, bản quyền hoặc chính sách quyền riêng tư thật. Sau khi có staging, dữ liệu được nhập qua Admin API theo quyền, không dùng SQL thủ công.
