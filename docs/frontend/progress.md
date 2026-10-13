# Tiến độ

**Tổng quan (13/10/2026):** 50/50 design (Figma, chờ duyệt) · 0/50 hoàn thành theo Definition of Done · 3/50 có route chạy (SY01–SY03, chưa E2E) · demo coverage 0/50 (Figma prototype không tính).

Definition of Done của một màn: xem [implementation-plan.md](implementation-plan.md) — route chạy thật, responsive 1440/768/390, đủ trạng thái, có test, CI xanh.

## Batch

| Batch | Trạng thái | Nhánh / PR | Ghi chú |
|---|---|---|---|
| B0 Audit + kế hoạch | Xong, chờ PR | `docs/frontend-route-audit` | Còn nợ: `api-matrix.md`, `permissions-matrix.md` (thông tin hiện nằm trong `route-audit.md`) |
| B1 Nền tảng + SY01–03 | Xong, chờ PR | `feat/frontend-b1-foundation` (nối tiếp B0) | lint / typecheck / test / build xanh — xem mục dưới |
| B2 Pilot ST01 | Sẵn sàng | — | Theo Figma `ST01 · Trang chủ` |
| B3 Storefront | Chưa bắt đầu | — | Sau khi B2 được duyệt |
| B4 Portal | Chưa bắt đầu | — | Thêm `lucide-react` khi dùng |
| B5 Admin 1 | Chưa bắt đầu | — | Q2 đã chốt: `/admin/*` |
| B6 Admin 2 | Chưa bắt đầu | — | |
| B7 Mô phỏng | Chưa bắt đầu | — | Luồng bắt buộc: sản phẩm → giỏ → thanh toán giả lập → đơn → license → tải file |
| B8 QA | Chưa bắt đầu | — | |

## Theo màn (Design / Code / QA tách riêng — spec §8.1)

Design: Figma "Hệ Thống Figma PGS". QA: `Not run / Failed / Passed / Approved`.

| ID | Design | Code | QA |
|---|---|---|---|
| ST01–ST13 | Figma xong, chờ duyệt | Chưa (ST13 Demo-only) | Not run |
| PT01–PT14 | Figma xong, chờ duyệt | Chưa | Not run |
| AD01–AD20 | Figma xong, chờ duyệt | Chưa | Not run |
| SY01 | Figma xong | Route `/403` ở portal + admin (B1) | Not run — chưa có E2E/responsive |
| SY02 | Figma xong | `not-found.tsx` ở web + portal + admin (B1) | Not run |
| SY03 | Figma xong | `error.tsx` + `global-error.tsx` ở 3 app (B1) | Not run |

## Kiểm tra đã chạy

### B1 — 13/10/2026

**Môi trường:** máy Windows này bật chính sách Application Control, chặn `turbo.exe` và binary SWC gốc của Next.js (`next-swc.win32-x64-msvc.node`). Vì vậy không chạy được `pnpm lint/build` trực tiếp trên host. Kiểm thử chạy trong container `node:22-bookworm` (Node 22.23.3, pnpm 11.20.0), trên **bản sao** working tree, theo đúng thứ tự `ci.yml`: `pnpm install --frozen-lockfile` → `db:generate` → `db:migrate` → `db:seed:local` (Postgres 16 + Redis 7 tạm thời) → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build --concurrency=2`.

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 11/11 task, 0 lỗi. Cảnh báo đều có từ trước (api, worker, admin `exhaustive-deps`, ui `fileName`) |
| `pnpm typecheck` | 17/17 task |
| `pnpm test` | 17/17 task — 734 test đạt, 0 trượt (api 405, utils 183, worker 77, portal 24, auth 18, web 12, admin 10, sdk 5) |
| `pnpm build` | 11/11 task; `/403`, `/_not-found` có trong build portal, admin, web |

Chưa chạy: worker smoke, acceptance phase 4–18 (cần MinIO; B1 không đổi backend), Playwright/axe (chưa có — B8).
