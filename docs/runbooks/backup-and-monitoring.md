# Sao lưu, diễn tập khôi phục và giám sát

Phạm vi: chuẩn bị hạ tầng (P2). Mọi script đã được kiểm chứng trên **dữ liệu giả** bằng hai bộ tự kiểm thử; chưa chạy trên staging hoặc production thật.

## 1. Những gì đã có

| Thành phần | Tệp | Việc làm |
|---|---|---|
| Sao lưu | `infra/scripts/backup-db.sh` | `pg_dump` → gzip → mã hóa AES-256 (openssl, PBKDF2) → sao chép ra ngoài máy chủ → xóa bản không mã hóa khỏi đĩa → ghi dấu thời gian `.last-success` / `.last-offsite-success` và bảng số dòng từng bảng (`.manifest.tsv`) |
| Khôi phục | `infra/scripts/restore-db.sh` | Kiểm tra checksum, tự giải mã tệp `.enc`, khôi phục trong một transaction |
| Diễn tập | `infra/scripts/restore-drill.sh` | Lấy bản **ngoài máy chủ** mới nhất, kiểm tra checksum, giải mã, khôi phục vào container tạm, so khớp chính xác số dòng từng bảng, đo thời gian (đầu vào cho RTO), ghi báo cáo JSON |
| Giám sát | `infra/monitoring/healthcheck.sh` | Kiểm tra URL các ứng dụng, độ mới của bản sao lưu/bản sao ngoài/lần diễn tập, dung lượng đĩa, hạn chứng chỉ TLS; chỉ báo khi trạng thái đổi + nhắc lại định kỳ |
| Cảnh báo | `infra/monitoring/alert.sh` | Webhook JSON (Slack/Mattermost/n8n) và Telegram; không có kênh nào thì ghi lỗi ra stderr, không im lặng |
| Lịch chạy | `infra/monitoring/systemd/*` | Sao lưu hằng ngày 02:30, giám sát mỗi phút, diễn tập hằng tháng |
| Cấu hình mẫu | `infra/monitoring/*.env.example` | Không chứa bí mật |
| Tự kiểm thử | `infra/scripts/backup-selftest.sh`, `infra/monitoring/selftest.sh` | Xem mục 4 |

## 2. Cài đặt (khi đã có máy chủ)

1. Sao chép repo tới `/opt/nexustheme`; tạo `/etc/nexustheme/backup.env` và `monitor.env` từ các tệp `.example` (quyền `600`).
2. Tạo khóa mã hóa một lần: `openssl rand -base64 48 > /etc/nexustheme/backup.key && chmod 400 /etc/nexustheme/backup.key`.
   **Lưu một bản sao khóa ở nơi khác (trình quản lý mật khẩu).** Mất khóa = mọi bản sao lưu không đọc được.
3. Cấu hình nơi lưu ngoài máy chủ: bucket S3-tương thích (`BACKUP_R2_BUCKET`, `STORAGE_ENDPOINT`, khóa AWS) và/hoặc `BACKUP_OFFSITE_DIR`. Nên dùng tài khoản/nhà cung cấp khác với máy chủ chính, quyền chỉ ghi thêm, bật versioning/khóa xóa.
4. `cp infra/monitoring/systemd/* /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now nexus-backup.timer nexus-monitor.timer nexus-restore-drill.timer`.
5. Chạy tay một lần: `systemctl start nexus-backup.service`, rồi `systemctl start nexus-restore-drill.service`; xem `journalctl -u nexus-restore-drill`.
6. Đặt `ALERT_WEBHOOK_URL` hoặc Telegram, rồi thử: `infra/monitoring/alert.sh INFO "thử cảnh báo" "xin chào"`.

## 3. Mục tiêu và giới hạn

- **RPO** hiện là chu kỳ sao lưu (mặc định 24 giờ, không phải 15 phút như `staging-disaster-recovery.md` ghi). Muốn RPO nhỏ hơn: chạy timer mỗi giờ hoặc bổ sung WAL archiving (chưa làm).
- **RTO**: lần diễn tập trên dữ liệu giả (1.450 dòng) mất ~9 giây — con số này **không** đại diện cho dữ liệu thật. Hãy lấy số đo từ lần diễn tập đầu tiên trên staging.
- Mới sao lưu **PostgreSQL**. Chưa sao lưu: tệp trong object storage (MinIO/R2 — bản phát hành sản phẩm), Redis, workflow/credential của n8n, `.env.production`. Cần quyết định riêng cho từng loại (R2 bucket versioning/replication; n8n export).
- Mã hóa dùng AES-256-CBC (openssl enc, không tự xác thực) nên mỗi bản sao lưu có thêm thẻ **HMAC-SHA256** (khóa dẫn xuất riêng từ tệp khóa) bao trùm hash của bản dump **và** manifest đã mã hóa. Kiểm tra thẻ này được thực hiện **trước khi giải mã/khôi phục** (estore-db.sh, estore-drill.sh, erify-backup.sh); thiếu hoặc sai thẻ, thiếu manifest, đổi khóa, sửa dump/manifest/checksum, hoặc có tệp .sql.gz không mã hóa ở nơi lưu ngoài đều làm thao tác thất bại. Không còn biến môi trường nào cho phép gửi bản không mã hóa ra ngoài (đã xóa BACKUP_ALLOW_UNENCRYPTED_OFFSITE); manifest chỉ được gửi dưới dạng mã hóa. Bản sao lưu cục bộ không mã hóa chỉ tồn tại khi không có tệp khóa và không có nơi lưu ngoài (dùng cho dev).
- Giám sát chạy trên chính máy chủ: nếu cả máy chủ chết, **không ai gửi cảnh báo**. Cần thêm một bộ theo dõi bên ngoài (UptimeRobot, Better Stack, healthchecks.io…) để theo dõi từ ngoài vào, và ping `healthchecks.io` từ job sao lưu. Chưa cấu hình vì cần tài khoản dịch vụ ngoài.
- Chưa có giám sát số liệu (CPU/RAM/độ trễ/tỷ lệ lỗi, Prometheus/Grafana/Sentry). Hiện chỉ có kiểm tra sống/chết, độ mới sao lưu, đĩa, TLS.

## 4. Kết quả kiểm thử đã thực hiện (dữ liệu giả)

`bash infra/scripts/backup-selftest.sh` (cần Docker): tạo CSDL giả 250 khách + 1.200 đơn (có tiếng Việt, dấu nháy, xuống dòng) rồi xác nhận:
- sao lưu → mã hóa → sao chép ra thư mục ngoài; **không còn bản không mã hóa** trên đĩa hay ở bản sao ngoài; tên bảng không đọc được trong tệp `.enc`;
- diễn tập khôi phục: PASS, số dòng từng bảng khớp manifest;
- bị từ chối: sai khóa; dump bị sửa 1 byte; manifest bị sửa; thiếu manifest; thiếu thẻ HMAC; kẻ tấn công thay dump bằng bản mã hóa bằng khóa khác và tính lại checksum; tệp .sql.gz không mã hóa ở nơi lưu ngoài; gửi ra ngoài khi không có khóa (kể cả đặt biến override cũ); giữ bản không mã hóa cùng nơi lưu ngoài; estore-db.sh với bản đã bị sửa. Khôi phục bản đúng bằng estore-db.sh đưa đủ dữ liệu về.

`bash infra/monitoring/selftest.sh`: webhook giả nhận đúng 1 cảnh báo FIRING khi ứng dụng sập (không lặp), 1 RESOLVED khi hồi phục, và cảnh báo khi dấu thời gian sao lưu quá cũ hoặc thiếu bản sao ngoài.

## 5. Quyết định đã chốt và việc còn lại (cần người có quyền thực hiện)

Quyết định (2026-10-19): lưu ngoài máy chủ ưu tiên **Cloudflare R2** (bucket backup riêng, private, token chỉ đúng quyền cần); cảnh báo ưu tiên **Telegram** cho nhân sự vận hành, bổ sung giám sát uptime bên ngoài; khóa mã hóa lưu trong **trình quản lý mật khẩu / secret manager độc lập với máy chủ**, không đưa vào GitHub; **staging chưa triển khai**, tiếp tục dùng môi trường thử nghiệm cách ly.

Script đã sẵn sàng cho các lựa chọn này (`BACKUP_R2_BUCKET` + `STORAGE_ENDPOINT` + khóa AWS cho R2; `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` cho cảnh báo). Phần dưới đây cần người có quyền truy cập tài khoản, tôi không thể và không nên tự làm:

1. Tạo bucket R2 riêng cho backup (private, không gắn domain công khai); tạo API token chỉ có quyền Object Read/Write trên đúng bucket đó; bật lifecycle giữ bản theo chính sách (hiện cục bộ 30 ngày).
2. Tạo bot Telegram (BotFather) và nhóm vận hành; lấy `TELEGRAM_CHAT_ID`; thử bằng `infra/monitoring/alert.sh INFO "thử" "xin chào"`.
3. Sinh khóa mã hóa (`openssl rand -base64 48`), cất bản sao trong trình quản lý mật khẩu của PGS **trước khi** chạy backup đầu tiên; kiểm tra bằng một lần diễn tập khôi phục từ bản R2.
4. Đăng ký một dịch vụ uptime bên ngoài (UptimeRobot / Better Stack) cho API, web, portal, admin; có thể thêm ping healthchecks.io từ job sao lưu để phát hiện khi cả máy chủ ngừng.
5. Chốt RPO/RTO chấp nhận được (hiện RPO = chu kỳ sao lưu).
6. Chưa sao lưu: object storage (bản phát hành sản phẩm), n8n, `.env.production` — cần quyết định riêng.