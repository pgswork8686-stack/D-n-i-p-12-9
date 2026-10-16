# QA evidence — Services Foundation (PR #27)

| Mục | Giá trị |
|---|---|
| Commit được kiểm thử | **`eec160a5e8706bb83b4ee947aa319dc6f62b7757`** (`feat/services-foundation`, HEAD của PR #27) |
| Thời gian chạy bộ kiểm chứng | 2026-10-15T16:58:12Z → 2026-10-15T17:08:27Z (UTC) |
| Môi trường | Windows 11 (máy dev), Git Bash; Node `v24.18.0`, pnpm `11.20.0`, Docker `29.7.2` |
| PostgreSQL | `postgres:16-alpine` (container cách ly `pgs-test-postgres`, cổng 55432) |
| Redis | `redis:7-alpine` (container `pgs-test-redis`, cổng 56379) |
| Object storage | MinIO `cgr.dev/chainguard/minio:latest` (container `pgs-test-minio`, cổng 59000, bucket `marketplace-dev`) |
| Biến môi trường | giống job `verify` của `.github/workflows/ci.yml`, chỉ đổi cổng (không có secret production) |
| Script | [`docs/qa/scripts/verify-all.sh`](scripts/verify-all.sh) — mỗi bước ghi thời điểm, lệnh, exit code |
| Log từng bước | [`services-foundation-steps-eec160a.tsv`](services-foundation-steps-eec160a.tsv) |
| GitHub Actions trên cùng SHA | run [`38773363853`](https://github.com/pgswork8686-stack/D-n-i-p-12-9/actions/runs/38773363853) — **7/7 success** (verify + 6 docker) |

### Bổ sung — HEAD mới `f2bf30a33e576ed6842411969659775561ff5ead` (2026-10-16)

`f2bf30a` chỉ thêm bản sửa F-11 (`assignMember` thử lại một lần khi P2002) và 2 test. Phần bằng chứng bên dưới vẫn là của `eec160a`; các số liệu sau là của `f2bf30a`:

| Hạng mục | Kết quả |
|---|---|
| GitHub Actions run [`38848035750`](https://github.com/pgswork8686-stack/D-n-i-p-12-9/actions/runs/38848035750) | **7/7 success** (verify + 6 docker) |
| Unit test Services (`pnpm --filter @nexus/api test -- services`) | 7 suite, **98/98** pass (gồm 2 test mới cho F-11) |
| Typecheck API (`tsc --noEmit`) | exit 0 |
| Lint API | 0 lỗi |
| Acceptance Services / phase 4→18 / Playwright | **chưa chạy lại** trên `f2bf30a`; dựa vào CI và kết quả `eec160a` ở trên |

### Bổ sung — nhánh tích hợp Frontend B0/B1 `feat/frontend-integration-b0-b1` (`fc1d05e`)

Merge `origin/feat/frontend-b1-foundation` (3 commit: `6a8a9bf`, `d513764`, `51bb27d`) vào `main` `1237c8c`; không xung đột. Kiểm tra cục bộ trong worktree riêng (Windows, Node v24.19.0):

| Hạng mục | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| Lint (`pnpm -r run lint`) | PASS — 0 lỗi (chỉ cảnh báo có sẵn) |
| Typecheck | PASS |
| Unit test | PASS — mọi suite; 4 suite API bị OS giết worker Jest (SIGTERM) khi chạy song song, chạy lại `--runInBand` 4/4 pass, 42 test |
| `next build` | **Không chạy được cục bộ**: chính sách Application Control của Windows chặn binary SWC. Bằng chứng build phải lấy từ CI/Docker |

Không có kết quả nào trong tài liệu này lấy từ commit cũ. CI xanh của `de08d77` (HEAD trước) **không** được dùng làm bằng chứng.

---

## 1. Tóm tắt

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Cài đặt (lockfile) | `pnpm install --frozen-lockfile` | PASS (exit 0) |
| Prisma generate | `pnpm db:generate` | PASS |
| Lint | `pnpm lint` | PASS — 11/11 task |
| Typecheck | `pnpm typecheck` | PASS — 17/17 task |
| Unit test | `pnpm test` | PASS — 17/17 task, **845 test**, 0 failed, 0 skipped |
| Prisma validate | `prisma validate` | PASS (một cảnh báo `SetNull` đã có sẵn trên `main`) |
| Migration | `pnpm db:migrate` (DB trống) | PASS — 24 migration |
| Migration drift | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | PASS — *No difference detected* |
| Seed | `pnpm db:seed:local` | PASS |
| Build monorepo | `pnpm build --concurrency=2` | **FAILED trên Windows** — xem §2 |
| Build API + worker | `pnpm --filter @nexus/api --filter @nexus/worker build` | PASS |
| Docker (Linux) | `docker build --target api\|worker\|migrate\|next(web\|portal\|admin)` | PASS — 6/6 image |
| Worker smoke | `pnpm worker:smoke` | PASS |
| Acceptance phase 4→18 | `pnpm test:acceptance:phase{4..18}` | PASS — 15/15 suite, 949 gate |
| Acceptance Services | `pnpm test:acceptance:services` | PASS — **69/69 gate** |
| UI runtime (Playwright) | `docs/qa/scripts/verify-ui.mjs` | PASS — 33/33 kiểm tra, 10 màn × 3 viewport + form |
| GitHub CI | `ci.yml` trên `eec160a` | PASS — 7/7 |

---

## 2. Build

`pnpm build` trên máy Windows dừng ở `@nexus/admin` và `@nexus/portal` với lỗi:

```text
Error: EPERM: operation not permitted, symlink 'D:\pgs-repo\node_modules\.pnpm\…' -> 'D:\pgs-repo\apps\admin\.next\standalone\…'
```

- **Nguyên nhân:** Next.js `output: "standalone"` cần tạo symlink khi copy file trace. Windows không cho tạo symlink khi chưa bật Developer Mode hoặc chưa có quyền tương ứng. Đây là giới hạn môi trường, không phải lỗi code.
- **Bằng chứng code build được:**
  - log cùng lượt có `✓ Compiled successfully`, type check và sinh static page xong trước khi tới bước copy trace;
  - build Linux qua `infra/docker/Dockerfile` (cùng cách CI build image) **thành công cho cả 6 target** trên `eec160a`;
  - job `docker` của GitHub Actions trên `eec160a` cũng thành công.
- Tác vụ build còn lại (packages, api, worker) thành công.

| Docker target | Kết quả | Thời gian |
|---|---|---|
| `api` | PASS | 90 s |
| `worker` | PASS | 3 s (cache) |
| `migrate` | PASS | 5 s (cache) |
| `next` APP=web | PASS | 55 s |
| `next` APP=portal | PASS | 56 s |
| `next` APP=admin | PASS | 57 s |

---

## 3. Database

| Kiểm tra | Kết quả |
|---|---|
| 24 migration trên DB trống | áp dụng đủ |
| Migration Services trên DB đang có dữ liệu (lượt trước, cùng file migration) | áp dụng được, không drift |
| Schema ↔ migration | không lệch |
| Bảng/cột hiện hữu bị đổi | không có (xem [review §2.1](../audit/services-foundation-pr27-review.md)) |

---

## 4. Unit test (`pnpm test`, `eec160a`)

| Package | Test | Ghi chú |
|---|---|---|
| `@nexus/api` | 501 passed | gồm 7 suite Services: rules, files, inquiries, projects, controllers, rate limiter, unique code |
| `@nexus/utils` | 183 passed | gồm feature flag `services` |
| `@nexus/worker` | 77 passed | không đổi |
| `@nexus/portal` | 24 passed | |
| `@nexus/web` | 18 passed | gồm `services-fetch.spec.ts` (6) |
| `@nexus/auth` | 18 passed | |
| `@nexus/admin` | 16 passed | gồm `permissions.spec.ts` (6) |
| `@nexus/sdk` | 8 passed | gồm 3 test multipart/query/lỗi của Services |
| **Tổng** | **845 passed, 0 failed, 0 skipped** | 17/17 task turbo |

---

## 5. Integration / acceptance (API thật + PostgreSQL + Redis + MinIO)

### 5.1 Services — 69/69 gate

[`packages/database/scripts/services-acceptance.ts`](../../packages/database/scripts/services-acceptance.ts) khởi động `apps/api/dist/main.js` (build từ `eec160a`) ba lần:

| Lượt | Cấu hình | Gate |
|---|---|---|
| Chính | `FEATURE_SERVICES=true`, rate limit IP 4/giờ (để kiểm 429) | 63 gate: catalog, validation, idempotency, honeypot, file sniffing, tên file UTF-8, rate limit, IDOR giữa 2 khách, RBAC, review/convert, chuyển trạng thái, cô lập dữ liệu nội bộ, audit, `/products` vẫn chạy |
| Flag tắt | `FEATURE_SERVICES=false` | 3 gate: `/v1/features` báo `services=false`; **mọi** route public/khách/admin của Services trả 404; Marketplace vẫn chạy |
| Redis không truy cập được | `REDIS_URL=redis://127.0.0.1:1` | 3 gate: gửi yêu cầu → 503 (fail-closed), không lưu bản ghi, catalog vẫn đọc được |

### 5.2 Regression — phase 4→18

| Suite | Gate | Kết quả |
|---|---|---|
| Phase 4 (commerce core) | 30 | PASS |
| Phase 5 (entitlement) | 33 | PASS |
| Phase 6 (external license) | 35 | PASS |
| Phase 7 (internal license) | 41 | PASS |
| Phase 8 (downloads) | 69 | PASS |
| Phase 9 (payment) | 77 | PASS |
| Phase 10 (portal) | 60 | PASS |
| Phase 11 (CMS/SEO) | 65 | PASS |
| Phase 12 (n8n automation) | 74 | PASS |
| Phase 13 (affiliate/membership) | 90 | PASS |
| Phase 14 (hosting) | 75 | PASS |
| Phase 15 (helpdesk) | 75 | PASS |
| Phase 16 (ledger/invoicing) | 75 | PASS |
| Phase 17 (storefront) | 75 | PASS |
| Phase 18 (hardening) | 75 | PASS |
| **Tổng** | **949** | **PASS** |

Worker smoke: `✓ WORKER SMOKE TEST: PASSED (Live BullMQ Queue Processed)`.

---

## 6. UI verification (Playwright)

| Mục | Giá trị |
|---|---|
| Công cụ | Playwright `1.48.0` (cùng phiên bản `apps/e2e` của B2), Chromium headless |
| Ứng dụng | `next dev` cho web/portal/admin + API `dist` của `eec160a`. **Không phải production build** (xem §2); production build chỉ được kiểm bằng Docker |
| Dữ liệu | tạo **qua API thật** bằng [`docs/qa/scripts/seed-demo.mjs`](scripts/seed-demo.mjs). Không chèn thẳng vào DB, không có fixture HTML |
| Đăng nhập | dev token (`dev-customer-token`, `dev-admin-token`) qua `localStorage`. Chỉ hoạt động khi `NODE_ENV ≠ production` |
| Kiểm tra mỗi màn | tràn ngang (`scrollWidth > innerWidth`), số `h1`, nội dung mong đợi, lỗi console/page, request API 4xx/5xx, chuỗi nội bộ không được xuất hiện ở trang khách |
| Kết quả thô | [`screenshots/services-foundation/ui-results-eec160a.json`](screenshots/services-foundation/ui-results-eec160a.json) |

| Màn | Route | 1440 | 768 | 390 | Ghi chú |
|---|---|---|---|---|---|
| Storefront danh sách | `/services` | PASS | PASS | PASS | |
| Storefront chi tiết + form | `/services/custom-web-app-development` | PASS | PASS | PASS | |
| Form gửi yêu cầu (gửi thật, ẩn danh) | `/services/api-integration#inquiry` | PASS (201) | PASS (201) | PASS (201) | thông báo "Đã nhận yêu cầu" + mã `SI-…` |
| Portal tổng quan | `/services` | PASS | PASS | PASS | lượt `a7ece72` phát hiện tràn ở 768 → sửa ở `eec160a` (F-03) |
| Portal chi tiết dự án | `/services/projects/:id` | PASS | PASS | PASS | DOM không chứa ghi chú nội bộ, tài liệu INTERNAL |
| Portal chi tiết yêu cầu | `/services/inquiries/:id` | PASS | PASS | PASS | DOM không chứa ghi chú nội bộ của staff |
| Admin danh mục | `/services` | PASS | PASS | PASS | 390: bảng cuộn ngang trong khung riêng (trang không tràn) |
| Admin danh sách dự án | `/service-projects` | PASS | PASS | PASS | |
| Admin danh sách yêu cầu | `/service-inquiries` | PASS | PASS | PASS | |
| Admin chi tiết yêu cầu | `/service-inquiries/:id` | PASS | PASS | PASS | |
| Admin chi tiết dự án | `/service-projects/:id` | PASS | PASS | PASS | |

Tổng: 33/33 kiểm tra đạt, 0 lỗi console, 0 request API lỗi.

### Ảnh chụp (OUTPUT 06)

Tên file: `<app>-<màn>-<viewport>-<commit>.png`, thư mục [`screenshots/services-foundation/`](screenshots/services-foundation/).

| Màn | Desktop 1440 | Tablet 768 | Mobile 390 |
|---|---|---|---|
| Storefront danh sách | [web-services-1440](screenshots/services-foundation/web-services-1440-eec160a.png) | [768](screenshots/services-foundation/web-services-768-eec160a.png) | [390](screenshots/services-foundation/web-services-390-eec160a.png) |
| Storefront chi tiết | [web-service-detail-1440](screenshots/services-foundation/web-service-detail-1440-eec160a.png) | [768](screenshots/services-foundation/web-service-detail-768-eec160a.png) | [390](screenshots/services-foundation/web-service-detail-390-eec160a.png) |
| Form (trống / đã gửi) | [trống](screenshots/services-foundation/web-inquiry-form-empty-1440-eec160a.png) · [đã gửi](screenshots/services-foundation/web-inquiry-form-submitted-1440-eec160a.png) | [trống](screenshots/services-foundation/web-inquiry-form-empty-768-eec160a.png) · [đã gửi](screenshots/services-foundation/web-inquiry-form-submitted-768-eec160a.png) | [trống](screenshots/services-foundation/web-inquiry-form-empty-390-eec160a.png) · [đã gửi](screenshots/services-foundation/web-inquiry-form-submitted-390-eec160a.png) |
| Portal tổng quan | [portal-services-1440](screenshots/services-foundation/portal-services-1440-eec160a.png) | [768](screenshots/services-foundation/portal-services-768-eec160a.png) | [390](screenshots/services-foundation/portal-services-390-eec160a.png) |
| Portal chi tiết dự án | [portal-project-detail-1440](screenshots/services-foundation/portal-project-detail-1440-eec160a.png) | [768](screenshots/services-foundation/portal-project-detail-768-eec160a.png) | [390](screenshots/services-foundation/portal-project-detail-390-eec160a.png) |
| Portal chi tiết yêu cầu | [portal-inquiry-detail-1440](screenshots/services-foundation/portal-inquiry-detail-1440-eec160a.png) | [768](screenshots/services-foundation/portal-inquiry-detail-768-eec160a.png) | [390](screenshots/services-foundation/portal-inquiry-detail-390-eec160a.png) |
| Admin danh mục | [admin-services-1440](screenshots/services-foundation/admin-services-1440-eec160a.png) | [768](screenshots/services-foundation/admin-services-768-eec160a.png) | [390](screenshots/services-foundation/admin-services-390-eec160a.png) |
| Admin danh sách yêu cầu | [admin-inquiries-1440](screenshots/services-foundation/admin-inquiries-1440-eec160a.png) | [768](screenshots/services-foundation/admin-inquiries-768-eec160a.png) | [390](screenshots/services-foundation/admin-inquiries-390-eec160a.png) |
| Admin chi tiết yêu cầu | [admin-inquiry-detail-1440](screenshots/services-foundation/admin-inquiry-detail-1440-eec160a.png) | [768](screenshots/services-foundation/admin-inquiry-detail-768-eec160a.png) | [390](screenshots/services-foundation/admin-inquiry-detail-390-eec160a.png) |
| Admin danh sách dự án | [admin-projects-1440](screenshots/services-foundation/admin-projects-1440-eec160a.png) | [768](screenshots/services-foundation/admin-projects-768-eec160a.png) | [390](screenshots/services-foundation/admin-projects-390-eec160a.png) |
| Admin chi tiết dự án | [admin-project-detail-1440](screenshots/services-foundation/admin-project-detail-1440-eec160a.png) | [768](screenshots/services-foundation/admin-project-detail-768-eec160a.png) | [390](screenshots/services-foundation/admin-project-detail-390-eec160a.png) |

Ảnh chụp từ ứng dụng đang chạy với dữ liệu thật trong DB test. Không có ảnh mô phỏng hay ảnh Figma.

---

## 7. Nhánh frontend B2 (đối chiếu, không thuộc PR #27)

Chạy trên `786eaa8` (HEAD `feat/frontend-b2-st01`) trong một git worktree riêng, cùng máy, ngày 2026-10-16. Đây là lần kiểm tra độc lập đầu tiên vì B0–B2 chưa có CI.

| Lệnh | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS — 11/11 |
| `pnpm typecheck` | PASS — 17/17 |
| `pnpm test` | PASS — 17/17 task, 754 test (api 405, utils 183, worker 77, web 32, portal 24, auth 18, admin 10, sdk 5) |
| Build, E2E Playwright, acceptance | **NOT RUN** trong phiên này |

---

## 8. Phụ thuộc bên ngoài chưa xác minh

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Staging/production | NOT RUN | không có quyền truy cập máy chủ staging/production trong phiên này |
| Supabase thật | NOT RUN | test dùng `DevMockAuthProvider` (dev token) |
| Cloudflare R2 thật | NOT RUN | test dùng MinIO (S3-compatible) |
| Topology proxy production (`trust proxy`) | NOT VERIFIED | F-07 — cần chủ dự án xác nhận |
| Figma | BLOCKED_BY_FIGMA_ACCESS | connector báo hết hạn mức MCP của gói Starter |
| Axe/accessibility tự động | NOT RUN | chỉ kiểm thủ công cơ bản (label, `role=alert`, honeypot `aria-hidden`) |
| Production build của Next trên Windows | FAILED (môi trường) | xem §2; đã thay bằng Docker Linux + CI |

---

## 9. Vấn đề chưa giải quyết

Xem [review §7](../audit/services-foundation-pr27-review.md): F-07 (P1, điều kiện bật flag), F-08 (P2, hạ tầng), F-11 (P3), F-12 (P2, cần quyết định). Không có lỗi test nào bị bỏ qua.
