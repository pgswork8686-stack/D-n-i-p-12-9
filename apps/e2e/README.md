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

Trình duyệt chạy trong container mà trang tham chiếu origin của máy host: dùng `E2E_REWRITE="http://localhost:4000=http://<api-host>:4000,http://localhost:9232=http://host.docker.internal:9232"`.

Trên máy Windows có Application Control chặn binary Chromium, chạy trong image `mcr.microsoft.com/playwright:v1.48.0-jammy` (cùng phiên bản `@playwright/test`).

## Phạm vi

| File | Màn | Kiểm tra |
|---|---|---|
| `tests/st01-home.spec.ts` | ST01 | thứ tự section, 1 `h1`, không cuộn ngang, console/ảnh lỗi, tìm kiếm + lọc qua API, tab danh mục theo thứ tự admin, card → trang chi tiết, card mobile đủ ảnh/tên/giá/CTA, header đủ nhóm ở 1440, form tư vấn (lỗi, không gửi request), bàn phím, axe (WCAG A/AA) |

Trạng thái rỗng/lỗi của trang chủ được test ở tầng render (`apps/web/app/__tests__/home-page-states.spec.tsx`) vì E2E không điều khiển được dữ liệu phía server.
