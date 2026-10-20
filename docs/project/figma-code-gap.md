# Figma ↔ code gap

**Trạng thái: BLOCKED** — phụ thuộc [figma-screen-inventory.md](figma-screen-inventory.md).

Những gì đã biết từ code (không thay thế đối chiếu Figma):
- Route UI hiện có: Storefront 17, Portal 25, Admin 31 trang — danh sách trong [feature-completion-matrix.md](feature-completion-matrix.md).
- E2E hiện kiểm: ST01, ST13; Portal các trang danh sách PT01–PT13 (tiêu đề tiếng Việt, không tràn ngang ở 1440/768/390) —
  riêng PT04 `/entitlements/[id]` chưa được spec nào mở, PT06 và PT09 chỉ được mở qua click và tự skip khi không có dữ liệu;
  Admin AD03–AD07, AD05, AD10–AD16; bảng Admin chuyển thành thẻ dưới 768px.
- Chưa có visual regression so với frame Figma.

Đối chiếu từng màn (điểm lệch, sửa, kiểm theo vai trò, screenshot 1440/768/390) sẽ làm sau khi đọc được Figma mới.
