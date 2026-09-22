# WordPress Client Plugin & Theme Architectural Contract (v1 Pre-Requisites)

## Mục Đích và Bối Cảnh

Tài liệu này xác lập bản **Hợp Đồng Kiến Trúc Bắt Buộc (Architectural Contract)** cho bất kỳ WordPress Theme hoặc Plugin nào do team NexusTheme phát hành từ phiên bản đầu tiên (**v1.0.0**).

Mặc dù backend NexusTheme hiện tại chưa kích hoạt Phase 16 (License Abuse & Site Fingerprint) và Phase 18 (Signed Update Channel), mã nguồn client v1 **bắt buộc phải nhúng sẵn hai cơ chế nền tảng** này ngay từ ngày đầu phát hành. 

> [!CRITICAL]
> Nếu bản client v1 phát hành mà thiếu hai cơ chế này, hệ thống sẽ gặp rủi ro nghiêm trọng:
> 1. Thiếu `installSalt`: Khi Phase 16 kích hoạt, hệ thống hoàn toàn không thể phân biệt hai bản clone/staging trên cùng domain hoặc reverse proxy.
> 2. Thiếu Ed25519 Verifier: Khi Phase 18 kích hoạt, toàn bộ khách hàng đang chạy bản cũ bắt buộc phải cập nhật bản vá qua chính kênh chưa được bảo vệ, tạo ra khoảng trống bảo mật (RCE window).

---

## 1. Yêu Cầu 1 — `installSalt` & Nhận Diện Bản Cài Đặt (Site Fingerprint)

### 1.1. Đặc tả kỹ thuật
1. **Sinh một lần lúc kích hoạt**: Khi plugin/theme được kích hoạt lần đầu tiên (`register_activation_hook` hoặc boot check), hệ thống sinh một chuỗi ngẫu nhiên mật mã 32-byte (`random_bytes(32)`), mã hóa sang định dạng **64 ký tự hex**.
2. **Lưu trữ an toàn trong `wp_options`**: Lưu với option key riêng biệt (ví dụ: `_nexustheme_install_salt`), đặt cờ `autoload = 'yes'`.
3. **Bảo mật tuyệt đối — Không gửi raw salt**: Chuỗi `installSalt` **tuyệt đối không bao giờ được gửi nguyên bản** lên API hay lưu vào các trường công khai.
4. **Tính toán Fingerprint cục bộ**:
   ```text
   fingerprint = HMAC-SHA256(TELEMETRY_PEPPER, canonicalDomain + siteUrlPath + dbPrefix + installSalt)
   ```
   - Trong đó:
     - `canonicalDomain`: Domain đã chuẩn hóa (chữ thường, bỏ `http://`, `https://`, port, query, trailing slash).
     - `siteUrlPath`: Đường dẫn sub-directory cài đặt (ví dụ: `/blog` hoặc chuỗi rỗng nếu ở root).
     - `dbPrefix`: Tiền tố bảng cơ sở dữ liệu (`$wpdb->prefix`, ví dụ `wp_`).
     - `installSalt`: Chuỗi 64-hex sinh một lần nói trên.
     - `TELEMETRY_PEPPER`: Secret pepper được máy chủ cung cấp hoặc nhúng tĩnh trong SDK client.

### 1.2. Rationale (Lý do bắt buộc)
Nếu chỉ dùng `canonicalDomain + siteUrlPath + dbPrefix` mà không có `installSalt`:
- Hai môi trường test/staging clone từ cùng một database trên cùng một hosting sub-domain/sub-path sẽ tạo ra fingerprint trùng lặp 100%.
- Khi khách hàng di chuyển host hoặc cài đặt lại WordPress với cùng tên miền, backend Phase 16 sẽ bị nhầm lẫn giữa việc "khách đổi host" và "nhiều bản cài đặt đang chạy song song", dẫn đến cảnh báo sai lệch (False Positive).

### 1.3. PHP Reference Implementation

```php
<?php
/**
 * NexusTheme Client Contract — Install Salt & Fingerprint Generator
 */

if (!defined('ABSPATH')) {
    exit;
}

class NexusTheme_Installation_Identity {
    const SALT_OPTION_KEY = '_nexustheme_install_salt';
    const FINGERPRINT_VERSION = 1;

    /**
     * Lấy hoặc khởi tạo installSalt một lần duy nhất.
     *
     * @return string Chuỗi 64 ký tự hex ngẫu nhiên
     */
    public static function get_or_create_install_salt(): string {
        $salt = get_option(self::SALT_OPTION_KEY, '');

        if (!empty($salt) && is_string($salt) && strlen($salt) === 64 && ctype_xdigit($salt)) {
            return $salt;
        }

        try {
            $salt = bin2hex(random_bytes(32));
        } catch (\Exception $e) {
            // Fallback bảo mật cao nếu CSPRNG hệ điều hành gặp lỗi
            $salt = hash('sha256', wp_generate_password(64, true, true) . microtime(true) . wp_salt('auth'));
        }

        update_option(self::SALT_OPTION_KEY, $salt, true);
        return $salt;
    }

    /**
     * Chuẩn hóa tên miền theo chuẩn canonical (RFC 3986).
     */
    public static function get_canonical_domain(): string {
        $home_url = get_home_url();
        $parsed = wp_parse_url($home_url);
        $host = strtolower($parsed['host'] ?? '');
        return preg_replace('/^www\./', '', $host);
    }

    /**
     * Tính toán site fingerprint theo chuẩn Phase 16.
     *
     * @param string $pepper Khóa bí mật telemetry do server cấp
     * @return array Cặp fingerprint và version
     */
    public static function compute_fingerprint(string $pepper): array {
        global $wpdb;

        $canonical_domain = self::get_canonical_domain();
        $parsed = wp_parse_url(get_home_url());
        $site_path = rtrim($parsed['path'] ?? '', '/');
        $db_prefix = $wpdb->prefix;
        $salt = self::get_or_create_install_salt();

        $raw_identity = $canonical_domain . '|' . $site_path . '|' . $db_prefix . '|' . $salt;
        $fingerprint = hash_hmac('sha256', $raw_identity, $pepper);

        return [
            'fingerprint'         => $fingerprint,
            'fingerprint_version' => self::FINGERPRINT_VERSION,
        ];
    }
}
```

---

## 2. Yêu Cầu 2 — Khe Public Key Ed25519 & Thẩm Định Chữ Ký Gói Cập Nhật

### 2.1. Đặc tả kỹ thuật
1. **Khe lưu trữ cặp Public Key (Dual-Key Slot)**:
   - Client phải lưu trữ tối thiểu **2 public key Ed25519** trong cấu trúc mảng (`key_id => public_key_hex`).
   - Mục đích: Cho phép backend **xoay khóa ký (Key Rotation)** trong cửa sổ chuyển tiếp 90 ngày mà không làm gián đoạn việc cập nhật của các phiên bản cũ.
2. **Khai báo payload cập nhật**:
   - Khi gọi `POST /v1/updates/check` (Phase 8), server trả về thêm 2 trường:
     - `signature`: Chữ ký số Ed25519 detached signature (dạng hex hoặc base64).
     - `signingKeyId`: Định danh khóa ký đang sử dụng (ví dụ: `ed25519_2026_01`).
3. **Thẩm định chữ ký trước khi giải nén (Pre-Extraction Verification)**:
   - Hook vào `upgrader_pre_install` hoặc `upgrader_source_selection` của WordPress.
   - Trước khi WordPress giải nén file `.zip` vào thư mục `/wp-content/plugins/` hoặc `/wp-content/themes/`, plugin phải:
     - Kiểm tra `signingKeyId` có nằm trong danh sách public key tin cậy không.
     - Tính `sha256` của file zip tạm: `$file_hash = hash_file('sha256', $downloaded_zip_path)`.
     - Tạo message chuẩn xác thực: `$message = $file_hash . '|' . $target_version . '|' . $product_id`.
     - Gọi `sodium_crypto_sign_verify_detached($signature, $message, $public_key)`.
   - **Xử lý thất bại (Fail-Closed)**:
     - Nếu chữ ký không hợp lệ: Lập tức hủy cài đặt, xóa file zip tải về khỏi `/tmp`, trả về đối tượng `WP_Error` giải thích nguyên nhân và ghi log.
     - Tuyệt đối không để WordPress giải nén gói tin chưa được xác thực.

### 2.2. Rationale (Lý do bắt buộc)
- **Chặn đứng nguy cơ RCE hàng loạt**: Kênh cập nhật tự động là vector tấn công nguy hiểm nhất. Nếu hacker thực hiện DNS spoofing, Man-in-the-Middle, hoặc chiếm quyền bucket Cloudflare R2, họ có thể đẩy một file zip chứa webshell về hàng chục ngàn website khách hàng.
- Chữ ký Ed25519 với Private Key được bảo vệ ngoài máy chủ phân phối (KMS/HSM) đảm bảo **kể cả khi hạ tầng lưu trữ bị xâm phạm, client vẫn từ chối cài đặt gói tin giả mạo**.
- Nếu v1 không có bộ verifier này, khi bật Phase 18 ở tương lai, ta không có cách nào nâng cấp khách hàng một cách an toàn.

### 2.3. PHP Reference Implementation

```php
<?php
/**
 * NexusTheme Client Contract — Ed25519 Update Package Signature Verifier
 */

if (!defined('ABSPATH')) {
    exit;
}

class NexusTheme_Package_Verifier {
    /**
     * Danh sách public key Ed25519 tin cậy (Hỗ trợ xoay khóa 90 ngày).
     * Format: key_id => 32-byte public key hex string
     */
    const TRUSTED_SIGNING_KEYS = [
        'nexustheme_ed25519_2026_primary' => 'a9f76bc039478f7e2d93e11049281a8b9e115049e394859a0f918e992147beef',
        'nexustheme_ed25519_2026_next'    => 'b1481d9f8472948e910248a8f9024817a940248b948172948a9184719284beef',
    ];

    /**
     * Đăng ký filter can thiệp vào tiến trình upgrader của WordPress.
     */
    public static function register_hooks(): void {
        add_filter('upgrader_pre_install', [__CLASS__, 'verify_downloaded_package'], 10, 2);
    }

    /**
     * Thẩm định chữ ký gói zip trước khi cho phép WordPress giải nén.
     *
     * @param bool|WP_Error $response Trạng thái cài đặt
     * @param array $hook_extra Metadata quá trình update
     * @return bool|WP_Error True nếu hợp lệ, WP_Error nếu chữ ký sai
     */
    public static function verify_downloaded_package($response, array $hook_extra) {
        // Chỉ áp dụng cho plugin/theme của NexusTheme
        if (empty($hook_extra['plugin']) || $hook_extra['plugin'] !== 'nexustheme-core/nexustheme-core.php') {
            return $response;
        }

        // Lấy thông tin chữ ký từ transient hoặc cache phản hồi updates/check
        $update_metadata = get_site_transient('nexustheme_pending_update_metadata');
        if (empty($update_metadata) || !is_array($update_metadata)) {
            return new WP_Error(
                'nexustheme_missing_signature_metadata',
                __('Lỗi cập nhật: Không tìm thấy chữ ký số của gói phát hành. Quá trình cài đặt bị hủy vì lý do bảo mật.', 'nexustheme')
            );
        }

        $signature_hex  = $update_metadata['signature'] ?? '';
        $signing_key_id = $update_metadata['signingKeyId'] ?? '';
        $target_version = $update_metadata['version'] ?? '';
        $product_id     = $update_metadata['productId'] ?? '';

        // 1. Kiểm tra sự tồn tại của thư viện Sodium (yêu cầu PHP >= 7.2)
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            return new WP_Error(
                'nexustheme_sodium_missing',
                __('Lỗi hệ thống: Máy chủ thiếu extension libsodium để xác thực chữ ký gói cập nhật.', 'nexustheme')
            );
        }

        // 2. Kiểm tra signing_key_id có thuộc danh sách tin cậy không
        if (!isset(self::TRUSTED_SIGNING_KEYS[$signing_key_id])) {
            return new WP_Error(
                'nexustheme_untrusted_key_id',
                sprintf(__('Lỗi bảo mật: Key ID ký gói cập nhật không được tin cậy (%s).', 'nexustheme'), esc_html($signing_key_id))
            );
        }

        $public_key_hex = self::TRUSTED_SIGNING_KEYS[$signing_key_id];
        $public_key_bin = hex2bin($public_key_hex);
        $signature_bin  = hex2bin($signature_hex);

        // 3. Đường dẫn file zip tạm mà WordPress vừa tải về
        $package_file_path = $hook_extra['package'] ?? '';
        if (empty($package_file_path) || !file_exists($package_file_path)) {
            return new WP_Error(
                'nexustheme_missing_package_file',
                __('Lỗi cập nhật: Không tìm thấy tệp tin gói cài đặt tạm thời.', 'nexustheme')
            );
        }

        // 4. Tính toán sha256 checksum của file zip
        $file_hash = hash_file('sha256', $package_file_path);
        if (!$file_hash) {
            return new WP_Error(
                'nexustheme_checksum_failed',
                __('Lỗi cập nhật: Không thể tính toán checksum của gói cài đặt.', 'nexustheme')
            );
        }

        // 5. Message định dạng canonical: sha256(file) || version || productId
        $canonical_message = $file_hash . '|' . $target_version . '|' . $product_id;

        // 6. Thẩm định mật mã học Ed25519
        $is_valid = sodium_crypto_sign_verify_detached($signature_bin, $canonical_message, $public_key_bin);

        if (!$is_valid) {
            // Xóa file tạm thời ngay lập tức để tránh phơi nhiễm
            @unlink($package_file_path);

            return new WP_Error(
                'nexustheme_invalid_signature',
                __('CẢNH BÁO BẢO MẬT: Chữ ký số của gói cập nhật KHÔNG HỢP LỆ! Tệp tin có thể đã bị sửa đổi hoặc giả mạo. Cập nhật đã bị chặn.', 'nexustheme')
            );
        }

        // Chữ ký hợp lệ — Cho phép WordPress tiếp tục giải nén
        return $response;
    }
}
```

---

## 3. Checklist Tuân Thủ Dành Cho Lập Trình Viên Plugin/Theme

Trước khi xuất xưởng bất kỳ bản `.zip` v1 nào cho khách hàng:
- [x] Đã gọi `NexusTheme_Installation_Identity::get_or_create_install_salt()` trong hook kích hoạt.
- [x] Đã kiểm tra `installSalt` lưu trong `wp_options` có độ dài đúng 64 ký tự hex ngẫu nhiên.
- [x] Tuyệt đối **không có** đoạn code nào gửi `installSalt` nguyên bản lên REST API.
- [x] Đã khai báo tối thiểu 2 key Ed25519 trong `TRUSTED_SIGNING_KEYS`.
- [x] Đã hook `verify_downloaded_package` vào filter `upgrader_pre_install`.
- [x] Đã test thử: Sửa đổi 1 byte trong file zip thử nghiệm → WordPress chặn cập nhật và hiển thị đúng thông báo lỗi.
