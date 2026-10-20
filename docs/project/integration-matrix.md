# Integration matrix

## 1. Git Integration Matrix

Trạng thái lấy từ GitHub ngày 2026-10-20. Không merge PR nào khi chưa có phê duyệt của PGS.

| PR | Phạm vi | Phụ thuộc / quan hệ | Migration | CI | Xung đột | Hành động đề xuất |
|---|---|---|---|---|---|---|
| #49 F-13 upload quota | API Services (guard trước Multer), acceptance gate 94–98 | Độc lập | Không | PASS | Không | Review → merge **trước** (nhỏ, độc lập) |
| #50 Replay guard n8n | `automation/n8n` + docs | Độc lập | Không | PASS | Không | Review bảo mật → merge; đặt `N8N_REPLAY_REDIS_*` khi triển khai n8n |
| #48 Figma sync P0 | Admin AD05–AD16, Portal tiếng Việt, AD10 đối soát, ST13, CI e2e-fullstack, n8n test isolation | **Chứa PR #47**; migration đối soát | **2** (`20261019000000_…_payment_reconciliation_cases`, `20261019010000_…_bigint_amounts`) — additive | PASS 8/8 | Với #46 (`ci.yml`) | Review → merge sau #49/#50; đóng #47 sau khi #48 vào `main` |
| #47 ST13 public pages API | API CMS PAGE publish-only | Đã nằm trong #48 | Không | PASS | — | Không merge riêng; đóng sau #48 |
| #46 Runtime smoke 4 app | CI step + script | Chồng phạm vi một phần với job `e2e-fullstack` | Không | PASS | Với #48 (`ci.yml`) | Sau khi #48 vào `main`: rebase, cân nhắc gộp vào job e2e hoặc giữ như smoke `next start` (build production) |

Thứ tự đề xuất: **#49 → #50 → #48 → rebase #46**. Sau mỗi merge: CI trên `main` phải xanh trước bước tiếp theo.

Migration của #48 (đọc từ SQL): migration thứ nhất chỉ tạo bảng mới `payment_reconciliation_cases` + 4 index, không khoá ngoại, không sửa bảng cũ;
migration thứ hai chỉ đổi hai cột số tiền của chính bảng mới đó sang `BIGINT`. Vì vậy là additive. Chạy thử trên bản sao DB có dữ liệu: chưa làm
(tuỳ chọn, P2 — acceptance chạy trên DB mới).

## 2. Hệ thống ngoài (External Dependencies)

| Hệ thống | Mục đích | Môi trường cần | Quyền cần | Người phụ trách | Trạng thái | Bằng chứng hiện có | Blocker |
|---|---|---|---|---|---|---|---|
| VPS staging | Chạy stack staging cách ly | staging | SSH/root, firewall | Quản trị hạ tầng | **BLOCKED** | Script `staging-preflight*.sh`, `vps-staging.md` | Chưa có VPS |
| DNS / Cloudflare | Domain, TLS, proxy | staging, prod | Quản trị zone | Quản trị hạ tầng | **BLOCKED** | Caddyfile + kiểm giới hạn request trong CI | Chưa có zone/record staging |
| Supabase Auth | Đăng nhập thật | staging | Project staging riêng | PGS / quản trị | **BLOCKED** | CI dùng token dev (API chỉ nhận khi `NODE_ENV≠production` **và** chưa cấu hình Supabase) | Chưa có project staging |
| Cloudflare R2 | Object storage private | staging, prod | Bucket + API token | Quản trị hạ tầng | **BLOCKED** | MinIO private trong CI, signed URL acceptance | Chưa có tài khoản R2 |
| SePay | Thanh toán VietQR + webhook | staging (tài khoản thử) | API token, webhook key | PGS (tài chính) | **BLOCKED** | AD10 E2E với mock SePay API trong CI | Chưa có tài khoản/cấu hình |
| Resend / SMTP | Email giao dịch | staging | API key, domain gửi | PGS | **BLOCKED** | n8n → sink giả: ORDER_PAID + LICENSE_PROVISIONED gửi đúng 1 lần (local) | Chưa có tài khoản/domain |
| n8n | Điều phối email/AI | staging | Instance + credential | Quản trị hạ tầng | **BLOCKED** | n8n 2.40.0 thật + Redis riêng, chạy local trên PR #48 `c4ca29e` (2026-10-19 ~17:04 UTC): runtime-smoke 16/16, live-flow 15/15 | Chưa có instance; repo chưa định nghĩa triển khai n8n |
| Redis cho replay guard n8n | Chống gửi lại | staging, prod | Redis riêng của n8n | Quản trị hạ tầng | **BLOCKED** | PR #50 yêu cầu `N8N_REPLAY_REDIS_HOST/PORT` | Chưa có định nghĩa triển khai |
| Telegram | Cảnh báo | staging, prod | Bot token + chat id | Quản trị hạ tầng | **BLOCKED** | `infra/monitoring/selftest.sh` trong CI (giả lập) | Chưa có bot |
| Secret manager | Quản lý bí mật | staging, prod | — | Quản trị hạ tầng | **BLOCKED** | — | Chưa chọn công cụ |
| Uptime monitor ngoài | Phát hiện VPS chết | prod | — | Quản trị hạ tầng | **BLOCKED** | — | Chưa có |
| Figma | Nguồn chuẩn UI/UX | — | Quyền đọc file Figma chính thức | PGS | **BLOCKED** | — | Connector Figma không kết nối trong phiên làm việc |

## 3. Tích hợp nội bộ (API ↔ Worker ↔ n8n)

| Luồng | Cơ chế | Kiểm chứng | Trạng thái |
|---|---|---|---|
| Order PAID → entitlement/license | Outbox (transaction) → worker | Acceptance phase 5/7 + E2E purchase-flow (CI) | PASS (môi trường test) |
| Worker → n8n dispatch | HTTP + HMAC (`X-Nexus-*`), requestId mới mỗi lần thử | runtime-smoke local (sai chữ ký / sai service → 0 lần gọi provider) | PASS (local); không có trong CI; staging BLOCKED |
| n8n → API callback | HMAC + chống replay (409) | Acceptance phase 12; live-flow local (job SUCCEEDED) | PASS (AC); live: local |
| n8n replay guard | Redis `SET NX PX` | `main`: replay lọt qua khi Redis có mật khẩu. PR #50: `check-replay-guard.mjs` trong CI (Redis giả RESP) + Redis 7 thật có mật khẩu chạy local (0/200 lọt) | `main`: **FAIL**; PR #50: PASS (chưa merge) |
| Services inquiry → thông báo nhân sự | Outbox → worker → notification (+ email qua n8n) | Services acceptance + ST01 form mode (CI) | PASS (thông báo), email qua n8n NOT VERIFIED |
