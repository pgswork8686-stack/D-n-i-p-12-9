# Proxy topology và `TRUST_PROXY_HOPS` (F-07)

API suy ra IP khách (`req.ip`) từ `X-Forwarded-For` bằng cách bỏ qua đúng số proxy mà **chúng ta** vận hành. Số đó được cấu hình bằng
`TRUST_PROXY_HOPS`. Sai số này là lỗi bảo mật, không phải lỗi hiển thị:

| Cấu hình sai | Hậu quả |
|---|---|
| Quá thấp | `req.ip` là địa chỉ proxy → mọi khách dùng chung một bucket rate limit, bị chặn lẫn nhau |
| Quá cao | Khách tự gửi `X-Forwarded-For` và chọn được IP của mình → vô hiệu mọi giới hạn theo IP (form yêu cầu dịch vụ, tải file, ...) |

Giới hạn theo email (3/giờ) của form dịch vụ vẫn hoạt động trong cả hai trường hợp; giới hạn theo IP thì không.

## Giá trị theo mô hình triển khai

| Mô hình | Chuỗi proxy | `TRUST_PROXY_HOPS` |
|---|---|---|
| **Staging (khuyến nghị): Caddy, Cloudflare "DNS only" (mây xám)** | Khách → Caddy → API | `1` |
| Production có Cloudflare proxy (mây cam) | Khách → Cloudflare → Caddy → API | `2`, **và** Caddy phải tin dải IP Cloudflare (xem dưới) |
| Local dev, gọi thẳng API | Khách → API | `0` (bị cấm khi `NODE_ENV=production`) |

Mặc định khi không đặt biến: `1` (giữ hành vi cũ) kèm cảnh báo lúc khởi động. Giá trị phải là số nguyên 0-5, nếu không API không khởi động.

Cổng API (4000) **không** được publish ra ngoài trong `infra/docker/production-compose.yml`; chỉ Caddy mở 80/443. Giữ nguyên như vậy, vì nếu
API nhận request trực tiếp thì mọi giá trị hop đều sai.

### Khi dùng Cloudflare proxy

Caddy chỉ giữ `X-Forwarded-For` do Cloudflare gửi nếu tin các IP đó; nếu không nó ghi đè bằng IP của Cloudflare và `TRUST_PROXY_HOPS=2` sẽ trả sai.
Thêm vào khối toàn cục của `infra/docker/Caddyfile` (danh sách dải IP lấy từ https://www.cloudflare.com/ips/ , phải cập nhật định kỳ):

```caddyfile
{
	servers {
		trusted_proxies static <các dải IPv4/IPv6 của Cloudflare>
		client_ip_headers X-Forwarded-For
	}
}
```

Chưa đưa vào Caddyfile mặc định vì staging dùng DNS only và danh sách dải IP cần được chủ hạ tầng xác nhận.

## Xác minh topology thực tế (bắt buộc trước khi bật `FEATURE_SERVICES` ở production)

1. Đặt `TRUST_PROXY_HOPS` theo bảng trên và khởi động lại API.
2. Từ một máy có IP công khai đã biết, gọi với `X-Forwarded-For` giả mạo:
   ```bash
   curl -s -o /dev/null -H "X-Forwarded-For: 6.6.6.6" https://$API_DOMAIN/health/liveness
   ```
3. Xem log của API (`docker compose logs api | tail`): trường `ip` của request đó phải là **IP công khai thật của máy bạn**.
   - Là `6.6.6.6` → số hop quá cao hoặc API đang nhận request không qua proxy. **Dừng**, không bật tính năng.
   - Là IP của Caddy/Cloudflare (dải riêng `172.x`, `10.x` hoặc dải Cloudflare) → số hop quá thấp hoặc Caddy chưa tin Cloudflare.
4. Ghi kết quả (ngày, mô hình, giá trị, IP thấy trong log) vào checklist go-live.

Đây là bước thủ công vì phụ thuộc hạ tầng thật; test tự động chỉ kiểm tra việc phân giải cấu hình (`apps/api/src/common/trust-proxy.spec.ts`).
