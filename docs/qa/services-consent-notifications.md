# QA evidence — F-12 consent + new-inquiry notifications

| Mục | Giá trị |
|---|---|
| Nhánh | `feat/services-consent-notifications` (nền: `feat/services-foundation` `f2bf30a`) |
| Môi trường | Windows 11, Node v24.19.0, pnpm 11.20.0, Docker 29.7.2 |
| Hạ tầng test | `postgres:16-alpine`, `redis:7-alpine`, `cgr.dev/chainguard/minio:latest` (container cách ly, cổng 55433/56380/59001) |
| CI GitHub | **Chưa có** cho nhánh này: `ci.yml` chỉ chạy với PR/push vào `main`, mà PR F-12 có base `feat/services-foundation`. CI sẽ chạy khi base được đổi sang `main` |

## Kết quả

| Hạng mục | Kết quả |
|---|---|
| Migration `20261016000000_…` trên Postgres 16 (sau 24 migration cũ) | PASS (`migrate deploy` exit 0) |
| Drift schema ↔ migration (`migrate diff --exit-code`) | PASS (exit 0, không drift) |
| `prisma validate` | PASS |
| Typecheck api / worker / web / admin / portal / sdk | PASS (0 lỗi) |
| Lint api / worker / web / admin / sdk / contracts / database | 0 lỗi (chỉ cảnh báo) |
| Unit API | **534/534** (thêm: consent-policy, DTO consent, service consent/outbox, DTO `isRead`) |
| Unit worker | 92/92 (thêm: notifier 13, outbox handler 3) |
| Unit web 27/27, admin 19/19, sdk 9/9 | PASS |
| Acceptance Services (HTTP, API thật + Postgres + Redis + MinIO + worker thật) | **90/90 gate** (69 cũ + 21 mới) |

Gate mới gồm: cấu hình consent công khai; consent thiếu/`false`/`"1"`/chỉ marketing → 400; phiên bản sai → 409 và không lưu gì;
version/timestamp là của server (bỏ qua giá trị client gửi); marketing mặc định `false` và có timestamp riêng khi tick;
admin thấy bằng chứng consent, khách thì không; outbox `PENDING` được ghi cùng transaction và không chứa dữ liệu cá nhân;
chưa ai được báo trước khi worker chạy; worker xử lý event; nhân sự có `inquiry.read` được báo, tài khoản không quyền thì không;
admin thấy thông báo qua API, khách thì không; một email job mỗi hộp thư với payload tối thiểu; chạy lại event không tạo thêm
thông báo/email job/audit; production thiếu `SERVICE_CONSENT_VERSION`/`PRIVACY_POLICY_URL` thì API không khởi động.

## Lỗi có sẵn được phát hiện và sửa trong lúc nghiệm thu

`GET /v1/notifications?isRead=false` trả về thông báo **đã đọc**: `@Type(() => Boolean)` biến chuỗi `"false"` thành `true`.
Banner Admin (và bất kỳ client nào lọc "chưa đọc") sẽ luôn trống. Đã sửa trong `tickets.dto.ts` (chỉ chuyển đúng `"true"`/`"false"`), có test.

## Giới hạn của lần chạy này

- Chưa chạy lại acceptance phase 4→18, worker smoke, `next build` và build Docker: máy kiểm thử chỉ còn ~0,5–1 GB RAM trống, nhiều tiến trình Node bị OOM
  (`nest build` và `ts-node` có kiểm tra kiểu không chạy được). `dist` của API cho acceptance được tạo bằng `ts.transpileModule` từng file
  (đã typecheck riêng bằng `tsc --noEmit`). Các bước này cần CI sau khi đổi base sang `main`.
- Chưa kiểm chứng gửi email thật: workflow n8n `/webhook/service-inquiry-notify-email` chưa tồn tại trong repo.
- Chưa có Playwright cho form có consent.
