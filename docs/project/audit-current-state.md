# Kiểm kê trạng thái hiện tại

Thời điểm kiểm kê: 2026-10-20. Nguồn: `git fetch` từ `origin`, GitHub API (PR, check runs), đọc code trên nhánh PR #48
(`feat/p0-figma-sync`, là tập cha của `main` + PR #47). Không dùng tuyên bố trong README làm bằng chứng.

## 1. Git và Pull Request

| Nhánh / PR | Head | So với `main` | CI | Ghi chú |
|---|---|---|---|---|
| `main` | `fc9508c` | — | PASS (verify + docker) | Merge gần nhất: PR #45 |
| PR #48 `feat/p0-figma-sync` (draft) | `867736e` | +33 commit | **PASS 8/8** ([run 39302137321](https://github.com/pgswork8686-stack/D-n-i-p-12-9/actions/runs/39302137321)) | Chứa trọn PR #47 (`git merge-base --is-ancestor 20570a4 867736e`); thêm 2 migration đối soát thanh toán (additive); thêm job `e2e-fullstack` |
| PR #49 `fix/services-upload-quota` (draft) | `4af7d33` | +4 | PASS 7/7 | F-13: quota upload theo tài khoản trước Multer |
| PR #50 `fix/n8n-replay-guard-redis-auth` (draft) | `bf16c0b` | +2 | PASS 7/7 | Replay guard n8n fail-closed (lỗ hổng khi Redis có mật khẩu) |
| PR #47 `feat/st13-published-pages-api` (draft) | `20570a4` | +3 | PASS | Đã nằm trọn trong PR #48 |
| PR #46 `test/ephemeral-fullstack-runtime-smoke` (draft) | `791f573` | +2 | PASS | Smoke khởi động 4 app; **xung đột `ci.yml` với PR #48** |

Gộp thử từng cặp (`git merge-tree`): #49+#48, #50+#48, #46+#50, #49+#50 sạch; **#46+#48 xung đột ở `.github/workflows/ci.yml`**
(cả hai chèn bước trước ST01). Chỉ PR #48 thêm migration.

Thứ tự tích hợp đề xuất và hành động: xem [integration-matrix.md](integration-matrix.md). Không PR nào được merge khi chưa có phê duyệt của PGS.

## 2. CI (`.github/workflows/ci.yml`)

- Job `verify`: shell syntax, backup/monitoring self-test, Caddy limits, staging preflight, content intake, lint, typecheck, unit,
  `n8n:validate`, build, worker smoke, acceptance phase 4→18, Services acceptance, ST01 Playwright (CTA + form).
- Job `e2e-fullstack` (PR #48): Storefront/Portal/Admin dưới `next dev` + API + worker trên runner riêng, DB mới;
  purchase-flow, Portal PT, Admin AD05/AD11–AD16, AD10 đối soát; fail khi có skip không phải skip theo viewport.
- Job `docker`: build image api, worker, migrate, web, portal, admin.
- `concurrency: cancel-in-progress` theo ref.
- **Branch protection**: chưa xác minh được (cần quyền admin repo). Comment trong `ci.yml` yêu cầu `verify`, `e2e-fullstack`, `docker`
  là required check — **PGS cần bật trong GitHub settings**, nếu không job đỏ không chặn merge.
- **Không có trong CI**: n8n runtime (`n8n:smoke`, `live-flow-check`), Supabase thật, SePay thật, R2, email thật, staging.

## 3. Ứng dụng và module

| Thành phần | Số lượng (đếm từ code) |
|---|---|
| API NestJS | 22 module; 50 controller / 208 handler dưới `modules/` (thêm `FeaturesController` dùng chung: 51 / 209) |
| Storefront (`apps/web`) | 17 trang |
| Customer Portal (`apps/portal`) | 25 trang |
| Admin (`apps/admin`) | 31 trang |
| Worker | 12 processor có unit test |
| Prisma | 63 model; 27 migration trên PR #48 (`main`: 25) |
| Unit test | API 60 file spec, worker 12, web 9, portal 7, admin 13, packages 19 |
| Acceptance | phase 4–18 + Services (HTTP + DB thật) |
| E2E Playwright | 7 spec (ST01, ST13, Portal PT, Admin AD, Admin legacy, purchase-flow, AD10) |

Chi tiết theo module: [feature-completion-matrix.md](feature-completion-matrix.md).

## 4. Feature flag

`packages/utils/src/feature-flags.ts`: mọi flag **TẮT khi `NODE_ENV=production`**, BẬT ở môi trường khác; ép bằng
`FEATURE_<NAME>=true|false`. `FeatureFlagGuard` toàn cục trả 404 cho route của module đang tắt.

| Flag | Module được bảo vệ | Production mặc định |
|---|---|---|
| `services` | Services Foundation (8 controller) | TẮT |
| `hosting` | Hosting | TẮT |
| `finance` | Thuế/hoá đơn/sổ cái | TẮT |
| `affiliate` | Affiliate | TẮT |
| `membership` | Subscriptions | TẮT |

Theo nguyên tắc phát hành: Hosting, Membership, Affiliate, Finance giữ TẮT cho đến khi được nghiệm thu riêng.

## 5. Hạ tầng trong repo

- `docker-compose.yml` (dev): postgres, redis, minio, minio-init.
- `infra/docker/production-compose.yml`: postgres, redis, migrate, api, worker, web, portal, admin, caddy.
- **Không có n8n** trong bất kỳ compose nào. Về `N8N_REPLAY_REDIS_*` chỉ có ví dụ env và dòng trong `environment-matrix.md` (PR #50),
  **chưa có định nghĩa triển khai**. n8n đang được hiểu là triển khai riêng (`docs/deployment/staging-rollout-plan.md`) — gap, xem
  [open-blockers.md](open-blockers.md) P0-1.
- Backup/restore: `infra/scripts/backup-*.sh`, `restore-*.sh`, self-test chạy trong CI trên dữ liệu tổng hợp.
- Monitoring: `infra/monitoring/*` (healthcheck, alert), self-test trong CI; kênh Telegram thật chưa kiểm chứng.

## 6. Phát hiện trong lần kiểm kê này

| Phát hiện | Mức | Trạng thái |
|---|---|---|
| Vai trò `customer` có `order.read`/`ticket.read`/`invoice.read` → khách đọc được mọi đơn hàng và ticket (kể cả ghi chú nội bộ) qua `/admin/*` (xác nhận bằng runtime) | **Bảo mật P0** | Đã sửa ở PR #52 (chưa merge) — [security-and-rbac-matrix.md](security-and-rbac-matrix.md) SEC-1 |
| Replay guard n8n chấp nhận replay khi Redis có mật khẩu (7/200 trên Redis thật) | Bảo mật | Đã sửa ở PR #50 (CI PASS, chưa merge) |
| Replay guard ngầm dùng `127.0.0.1:6379` khi thiếu cấu hình | Bảo mật/vận hành | Đã sửa ở PR #50 |
| Bước ST01 trên CI chạy mọi spec nên PR #48 đỏ (94 lỗi do thiếu Portal/Admin) | CI | Đã sửa ở PR #48 (job `e2e-fullstack`) |
| Hai spec E2E tự skip vì đếm DOM trước khi dữ liệu tải xong (AD11, PT05) | Test | Đã sửa ở PR #48 |
| `infra/scripts/backup-selftest.sh` để lại volume ẩn danh mỗi lần chạy (`docker rm -f` không `-v`) | Vệ sinh môi trường | Mở (P2) |
| Webhook n8n trả 200 ngay khi nhận: dispatch bị Verify từ chối không hiển thị với worker | Quan sát | Mở (P1), đã ghi trong tài liệu PR #50 |
| Route chẩn đoán `rbac/test/{customer,admin,audit}` đăng ký cả ở production (có AuthGuard + PermissionsGuard) | Bề mặt API | Mở (P2) |
| Một số gate acceptance chỉ kiểm tĩnh hoặc gán cứng `true` (AC 15 gate 70–74; AC 18 gate 57, 65 và nhóm kiểm file/chuỗi) | Chất lượng bằng chứng | Đã ghi rõ trong [feature-completion-matrix.md](feature-completion-matrix.md); không tính là bằng chứng runtime |
