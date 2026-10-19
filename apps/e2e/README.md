# @nexus/e2e — Playwright end-to-end tests

Chạy trên một stack **đang chạy** (web + API) với dữ liệu demo. Không nằm trong `pnpm test` vì cần server thật.

## Chạy

```bash
# 1. Stack cách ly: Postgres/Redis tạm, API (NODE_ENV=development), web.
# 2. Tạo dữ liệu demo qua Admin API (chỉ chấp nhận localhost hoặc host trong SEED_ALLOW_HOSTS):
E2E_API_URL=http://localhost:4000 pnpm --filter @nexus/e2e seed:demo
#    Ảnh demo: API chưa có endpoint media, script chỉ ghi SQL vào results/demo-media.sql —
#    chỉ áp vào DB tạm.
# 3. Chạy test:
E2E_BASE_URL=http://localhost:3000 E2E_API_URL=http://localhost:4000 pnpm --filter @nexus/e2e test:e2e
```

`E2E_CONSULT_MODE=cta` (mặc định — Services tắt hoặc chưa có dịch vụ `custom-web-app-development` đang ACTIVE: trang chủ hiện CTA hỗ trợ) hoặc `form` (stack bật `FEATURE_SERVICES=true`, đã seed và công khai dịch vụ, API đã cấu hình `SERVICE_CONSENT_VERSION`/`PRIVACY_POLICY_URL`: trang chủ hiện form gửi thật): chọn bộ test của khối tư vấn ST01; test của chế độ còn lại bị bỏ qua có ghi lý do. Chế độ `form` tạo yêu cầu thật trong DB của stack đang test, chỉ chạy trên stack dùng thử.

Trình duyệt chạy trong container mà trang tham chiếu origin của máy host: dùng `E2E_REWRITE="http://localhost:4000=http://<api-host>:4000,http://localhost:9232=http://host.docker.internal:9232"`.

Trên máy Windows có Application Control chặn binary Chromium, chạy trong image `mcr.microsoft.com/playwright:v1.48.0-jammy` (cùng phiên bản `@playwright/test`).

## Phạm vi

| File | Màn | Kiểm tra |
|---|---|---|
| `tests/st01-home.spec.ts` | ST01 | thứ tự section, 1 `h1`, không cuộn ngang, console/ảnh lỗi, tìm kiếm + lọc qua API, tab danh mục theo thứ tự admin, card → trang chi tiết, card mobile đủ ảnh/tên/giá/CTA, header đủ nhóm ở 1440, form tư vấn (lỗi, không gửi request), bàn phím, axe (WCAG A/AA) |

| `tests/admin-ad05-ad16.spec.ts` | AD05, AD11–AD16 | chạy với API, DB và MinIO thật, đăng nhập bằng token dev (`dev-admin-token`, `dev-customer-token`; Admin phải chạy với `NEXT_PUBLIC_DEV_AUTH_ENABLED=true`). Đặt `E2E_ADMIN_URL` (mặc định `http://localhost:3002`). Test ghi dữ liệu (ticket, phiên bản) chỉ chạy ở project desktop. Kiểm tra: danh sách thật, thu hồi phải có lý do, key license luôn bị che, ghi chú nội bộ ticket không lộ cho khách, tạo phiên bản → tải `.zip` → phát hành, không cuộn ngang ở 1440/768/390, bảng thành thẻ có nhãn trên điện thoại |
| `tests/portal-pt.spec.ts` | PT01–PT13 | chạy với API và DB thật, đăng nhập bằng `dev-customer-token` (Portal phải chạy với `NEXT_PUBLIC_DEV_AUTH_ENABLED=true`). Đặt `E2E_PORTAL_URL` (mặc định `http://localhost:3001`). Kiểm tra: tiêu đề tiếng Việt và không tràn ngang ở 1440/768/390, lọc đơn hàng, khách tạo ticket → thấy phản hồi nhân viên nhưng không thấy ghi chú nội bộ, không mở được ticket của khách khác, license luôn bị che và chỉ hiện khi bấm, chưa đăng nhập bị chuyển tới trang đăng nhập |
| `tests/admin-legacy.spec.ts` | AD01, AD03, AD04, AD07, AD17–AD20 | tiêu đề tiếng Việt và không tràn ngang ở 1440/768/390 cho sản phẩm, nội dung, danh mục, tự động hóa; luồng thật tạo sản phẩm → thêm gói → thêm giá → đăng bán. Cùng cách đăng nhập token dev như spec Admin khác (`E2E_ADMIN_URL`) |

Trạng thái rỗng/lỗi của trang chủ được test ở tầng render (`apps/web/app/__tests__/home-page-states.spec.tsx`) vì E2E không điều khiển được dữ liệu phía server.
