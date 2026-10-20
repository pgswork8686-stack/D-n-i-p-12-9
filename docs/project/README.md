# docs/project — nguồn sự thật về trạng thái dự án NexusTheme

Thư mục này là **nơi duy nhất** ghi trạng thái hiện tại của toàn hệ thống (code, CI, luồng nghiệp vụ, blocker, go-live).
Mỗi kết luận phải có bằng chứng kiểm chứng được: commit SHA, CI run, lệnh đã chạy và kết quả. Tuyên bố trong `README.md`
gốc hay tài liệu cũ **không** được coi là bằng chứng.

Cập nhật lần cuối: 2026-10-20, theo `main` = `fc9508c` và các nhánh PR đang mở (xem [audit-current-state.md](audit-current-state.md)).

## Nhãn trạng thái

| Nhãn | Nghĩa |
|---|---|
| `PASS` | Đã chạy thật và đạt, có bằng chứng (CI run / log / lệnh) |
| `FAIL` | Đã chạy và không đạt |
| `BLOCKED` | Không thể kiểm chứng vì thiếu quyền, tài khoản, hạ tầng hoặc phê duyệt; ghi rõ ai cần làm gì |
| `NOT VERIFIED` | Có code/test ở mức thấp hơn nhưng **chưa** chạy trên hệ thống thật tương ứng (ví dụ chỉ chạy với mock) |
| `NOT APPLICABLE` | Ngoài phạm vi phát hành hiện tại (ví dụ module bị feature flag tắt ở production) |

## Tài liệu

| Tài liệu | Nội dung | Trạng thái |
|---|---|---|
| [audit-current-state.md](audit-current-state.md) | Kiểm kê repo, Git/PR, CI, module, feature flag, hạ tầng | Có |
| [integration-matrix.md](integration-matrix.md) | Git Integration Matrix + phụ thuộc hệ thống ngoài | Có |
| [feature-completion-matrix.md](feature-completion-matrix.md) | Module → API → route UI → test → trạng thái | Có |
| [end-to-end-flow-map.md](end-to-end-flow-map.md) | Các luồng nghiệp vụ end-to-end và bằng chứng | Có |
| [open-blockers.md](open-blockers.md) | Blocker và backlog P0/P1 | Có |
| [figma-screen-inventory.md](figma-screen-inventory.md) | Inventory màn hình theo Figma mới nhất | **BLOCKED** (chưa đọc được Figma) |
| [figma-code-gap.md](figma-code-gap.md) | Đối chiếu Figma ↔ code | **BLOCKED** |
| [security-and-rbac-matrix.md](security-and-rbac-matrix.md) | Guard/permission của mọi endpoint, IDOR, vai trò ↔ quyền, phát hiện bảo mật | Có |
| qa-and-uat-evidence.md, staging-readiness.md, go-live-readiness.md, release-and-rollback-plan.md | | Chưa tạo (milestone sau) |

## Tài liệu cũ và quan hệ với thư mục này

| Tài liệu cũ | Ngày cập nhật cuối | Xử lý |
|---|---|---|
| `docs/audit/*.md` | 2026-10-07 | **Lỗi thời** so với code hiện tại; giữ làm lịch sử, trạng thái hiện hành xem `docs/project/` |
| `docs/frontend/screen-registry.md`, `route-audit.md` | 2026-10-12 | Inventory theo Figma **cũ** (ST/PT/AD/SY); chỉ là baseline, không phải inventory Figma mới nhất |
| `docs/frontend/progress.md`, `backlog.md` | 2026-10-16 | Tiến độ frontend trước PR #48; đối chiếu lại khi đọc được Figma mới |
| `docs/runbooks/*.md` | 2026-10-07 | Cần đối chiếu lại với code (lịch/định dạng backup, staging) trước go-live — chưa làm |
| `docs/deployment/*.md` | 2026-10-10 → 2026-10-16 | Vẫn dùng; `environment-matrix.md` được cập nhật thêm ở PR #50 |
