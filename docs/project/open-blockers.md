# Open blockers và backlog

Cập nhật: 2026-10-20. Ưu tiên: **P0** = chặn vận hành thật / go-live; **P1** = cần trước go-live nhưng không chặn kiểm thử; **P2** = cải thiện.

## Blocker cần người có quyền xử lý

| # | Blocker | Chặn | Người cần làm | Việc cụ thể |
|---|---|---|---|---|
| B1 | Không đọc được file Figma chính thức | Inventory/đối chiếu UI theo Figma mới (Giai đoạn B) | PGS | Kết nối lại connector Figma trên claude.ai hoặc mở Figma desktop có plugin bridge; hoặc cung cấp export |
| B2 | Chưa có VPS staging | Mọi kiểm chứng staging (Giai đoạn G) | Quản trị hạ tầng | Cấp VPS, firewall, SSH |
| B3 | Chưa có Supabase project staging | Đăng nhập thật, RBAC thật | PGS / quản trị | Tạo project, cấp key qua secret manager |
| B4 | Chưa có R2 | Upload/tải file private thật | Quản trị hạ tầng | Bucket private + token |
| B5 | Chưa có tài khoản SePay (thử) | Webhook thanh toán thật | PGS (tài chính) | Tài khoản, API token, webhook key |
| B6 | Chưa có Resend/SMTP + domain gửi | Email thật | PGS | Tài khoản, xác thực domain |
| B7 | Chưa có n8n staging + Redis replay riêng | Email/AI qua n8n trên staging | Quản trị hạ tầng | Instance n8n, Redis riêng, `N8N_REPLAY_REDIS_*` (PR #50) |
| B8 | Chưa có Telegram bot, uptime monitor ngoài, secret manager | Giám sát/cảnh báo thật | Quản trị hạ tầng | Cấp cấu hình |
| B9 | 6 chính sách chưa được phê duyệt | Xuất bản chính sách; bật form dịch vụ production | PGS + bộ phận có thẩm quyền | Duyệt nội dung |
| B10 | Merge PR cần phê duyệt | Đưa thay đổi vào `main` | PGS | Duyệt #49 → #50 → #48 (xem [integration-matrix.md](integration-matrix.md)) |
| B11 | Branch protection: chưa xác minh được cấu hình hiện tại; `CI / e2e-fullstack` chưa thể là required check | Job E2E đỏ có thể không chặn merge | Admin repo | Kiểm tra cấu hình; thêm `CI / e2e-fullstack` **sau khi #48 vào `main`** (bật trước sẽ chặn #49/#50, vốn không có job này) |

## Backlog P0 (làm được trong repo, không cần tài khoản ngoài)

| # | Việc | Lý do | Trạng thái |
|---|---|---|---|
| P0-1 | Định nghĩa triển khai n8n + Redis replay riêng cho staging (compose/service hoặc tài liệu triển khai) | Repo không có n8n trong compose nào; thiếu thì email không chạy, hoặc replay guard dùng nhầm Redis | Cần PGS chọn nơi chạy n8n (cùng VPS hay riêng) |
| P0-2 | Ma trận RBAC/IDOR đầy đủ theo endpoint (security-and-rbac-matrix), gồm gán/gỡ vai trò và vai trò staff chỉ đọc | Yêu cầu Giai đoạn E; hiện chỉ có unit cho gán vai trò | Chưa làm |
| P0-3 | Kiểm chứng SePay đúng số tiền → PAID ngoài unit (E2E với mock SePay) | AD10 E2E chỉ phủ ngoại lệ | Chưa làm |

## Backlog P1

| # | Việc | Ghi chú |
|---|---|---|
| P1-1 | Đưa n8n runtime (smoke/live-flow với Redis riêng) vào CI | Hiện chỉ chạy local |
| P1-2 | Kiểm tra skip cho ST01 (đang chỉ kiểm cho e2e-fullstack); ST01 chạy hai chế độ ghi đè cùng `report.json` | |
| P1-3 | Theo dõi độ ổn định job `e2e-fullstack` (mới 2 lần CI) | `next dev` biên dịch route lần đầu |
| P1-4 | Quan sát dispatch bị n8n từ chối (webhook trả 200 ngay khi nhận) | Job chỉ lộ ra khi bị thu hồi do treo |
| P1-5 | Retry khi provider email không phản hồi; worker khi n8n restart | Chưa có kiểm thử |
| P1-6 | Đối chiếu runbook (backup, staging, cutover) với code hiện tại | `docs/runbooks/*` từ 2026-10-07 |
| P1-7 | Giải quyết xung đột `ci.yml` PR #46 ↔ PR #48 | Rebase PR merge sau |
| P1-8 | Chạy lại n8n runtime-smoke + live-flow sau khi #50 và #48 vào `main` | Bằng chứng hiện tại là trên nhánh |
| P1-9 | Thay các gate acceptance gán cứng/kiểm tĩnh bằng kiểm runtime (AC 15 gate 70–74; AC 18 gate 57, 65, 66 và nhóm kiểm file) | Hiện không phải bằng chứng |

## Backlog P2

| # | Việc |
|---|---|
| P2-1 | `backup-selftest.sh` để lại volume ẩn danh (`docker rm -f` thiếu `-v`) |
| P2-2 | Trang Portal của module bị tắt hiển thị lỗi API khi mở thẳng URL; nên hiện trạng thái "không khả dụng" |
| P2-3 | PT08 lọc trạng thái phía client — đủ ổn định, nhưng có thể chờ rõ ràng như PT05 |
| P2-4 | Route chẩn đoán `rbac/test/*` đăng ký cả ở production — cân nhắc chỉ đăng ký ngoài production |
| P2-5 | Chạy thử migration đối soát (#48) trên bản sao DB có dữ liệu (đọc SQL đã thấy additive) |
