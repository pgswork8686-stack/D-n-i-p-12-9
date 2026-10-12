# Tiến độ

**Tổng quan:** 1/50 design (ST01, đang review) · 0/50 implemented · 0/50 tested · demo coverage 0/50.

## Batch

| Batch | Trạng thái | PR | Ghi chú |
|---|---|---|---|
| B0 Audit + kế hoạch | Đang làm | — | Xong: `route-audit.md`, `screen-registry.md`, `implementation-plan.md`, ảnh + ghi chú ST01. Còn: `api-matrix.md`, `permissions-matrix.md`, CI baseline (spec §8) |
| B1 Nền tảng + SY01–03 | Chưa bắt đầu | — | |
| B2 Pilot ST01 | Sẵn sàng sau B1 | — | Ảnh tham chiếu đã có (bản 374 px — xin bản 1440 px để khớp chi tiết) |
| B3 Storefront | Chưa bắt đầu | — | Chờ B2 được duyệt |
| B4 Portal | Chưa bắt đầu | — | |
| B5 Admin 1 | Chưa bắt đầu | — | Chờ Q2 |
| B6 Admin 2 | Chưa bắt đầu | — | |
| B7 Mô phỏng | Chưa bắt đầu | — | |
| B8 QA | Chưa bắt đầu | — | |

## Theo màn (Design / Code / QA tách riêng — spec §8.1)

Code: trạng thái audit từ [screen-registry.md](screen-registry.md); chuyển thành `Done` khi PR merge. QA: `Not run / Failed / Passed / Approved`.

| ID | Design | Code | QA |
|---|---|---|---|
| ST01 | Review | Refactor | Not run |
| ST02 | Draft (có prompt) | Refactor | Not run |
| ST03–ST09, ST11–ST12 | Not started | Refactor | Not run |
| ST10 | Not started | Implement | Not run |
| ST13 | Not started | Demo-only | Not run |
| PT01–PT11, PT13 | Not started | Refactor | Not run |
| PT12 | Not started | Reuse | Not run |
| PT14 | Not started | Implement (2FA Blocked) | Not run |
| AD01–AD04, AD07, AD08, AD17–AD20 | Not started | Refactor | Not run |
| AD05, AD06, AD09–AD16 | Not started | Implement | Not run |
| SY01 | Not started | Implement | Not run |
| SY02, SY03 | Not started | Refactor / Implement | Not run |

## Kiểm tra đã chạy

Chưa chạy lint/typecheck/test/build — B0 chỉ thêm tài liệu, không đổi code.
