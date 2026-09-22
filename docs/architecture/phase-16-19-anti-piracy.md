Phase 16–19 — Anti-Piracy & Abuse Defense
Sep 22, 2026 · @PGS
Bốn phase nối sau roadmap 15 phase hiện tại, bảo vệ doanh thu trên bốn trục: chống share license, chống gian lận thanh toán, ký số kênh cập nhật, và truy vết bản rò rỉ. Nguyên tắc xuyên suốt: code chạy trên máy khách không bao giờ là authority.
Nguyên tắc nền
Bốn ràng buộc dưới đây quyết định thiết kế của cả bốn phase. Bỏ qua chúng thì code viết ra hoặc vô dụng về kỹ thuật, hoặc rủi ro về pháp lý.
Client không bao giờ là authority. Plugin chạy trên site khách có thể bị sửa; mọi if (!license_valid) die() đều gỡ được trong vài phút. Telemetry vì vậy dùng để phát hiện và truy vết, tuyệt đối không dùng làm cơ chế chặn.
Theme và plugin WordPress là GPL. Code PHP giao cho khách kế thừa GPL v2, nên khách có quyền hợp pháp redistribute. Mô hình đúng — cũng là mô hình Elementor và WooCommerce đang dùng — là bán quyền nhận update, support và asset cloud, không bán quyền chạy code. Hệ quả trực tiếp: Phase 18 mang giá trị thương mại cao nhất, còn Phase 19 chỉ phục vụ truy vết chứ không phải căn cứ pháp lý.
Obfuscate PHP vừa mâu thuẫn GPL vừa gần như vô giá trị. ionCube và SourceGuardian bị bẻ nhanh, làm khách thật khó debug, và vi phạm điều khoản WordPress.org. Chỉ obfuscate JS bundle không thuộc GPL hoặc phần lõi chạy server-side.
Telemetry là dữ liệu cá nhân. Domain, IP và email gắn với nhau là personal data theo GDPR. Lưu ipHash dạng HMAC có pepper, retention 90 ngày, công bố trong ToS, và cho khách xem được dữ liệu plugin gửi đi.
Phase 16 — License Abuse & Site Fingerprint
Chặn việc một key chạy trên nhiều site hơn số ghế đã mua, bằng phát hiện thay vì bằng DRM. Phụ thuộc Phase 7 (internal license) và Phase 8 (download).
Migration (additive)
Bảng
Thay đổi
license_activations
Thêm site_fingerprint, fingerprint_version, environment, last_seen_at, last_seen_ip_hash
license_heartbeats (mới)
Append-only: license_id, activation_id, normalized_domain, site_fingerprint, ip_hash, country_code, plugin_version, php_version, received_at
license_abuse_signals (mới)
license_id, signal_type, severity, evidence_json, detected_at, resolved_at, resolution, resolved_by
entitlements
Thêm abuse_status enum CLEAN / WATCH / RESTRICTED / SUSPENDED, mặc định CLEAN
abuse_status là trục độc lập với status hiện có. Không đụng vào state machine entitlement của Phase 5.
Fingerprint
fingerprint = HMAC-SHA256(pepper, canonicalDomain + siteUrlPath + dbPrefix + installSalt), với installSalt sinh một lần và lưu trong site khách. fingerprint_version cho phép đổi thuật toán sau mà không phá dữ liệu cũ. Không dùng IP làm thành phần fingerprint vì CDN và IP động làm nó vô nghiĩa.
Miễn trừ môi trường: localhost, *.local, *.test, tiền tố staging. / dev. / test., và WP_ENVIRONMENT_TYPE != production không tính vào maxActivations. Chúng có hạn mức riêng (mặc định 3 site) và vẫn ghi heartbeat. Đây là điểm khách thật bức nhất nếu làm sai — phải làm trước khi bật bất kỳ tín hiệu nào.
Endpoint
• POST /v1/licenses/heartbeat — channel LICENSE_RUNTIME. Nhận { licenseKey, domain, fingerprint, versions }, trả { valid, gracePeriodEndsAt, notices[] }. Rate limit Lua ZSET tái dùng hạ tầng Phase 8, khóa theo licenseId + fingerprint: 1 lần / 6 giờ, burst 3 / 24 giờ. Chống vét cạn giống validate: key sai trả { valid: false } HTTP 200.
• GET /admin/licenses/:id/abuse-signals — RBAC license.manage.
• POST /admin/licenses/:id/abuse-signals/:signalId/resolve — ghi resolved_by, audit ABUSE_SIGNAL_RESOLVED.
• GET /licenses/:id/activations (Phase 10, mở rộng) — trả thêm lastSeenAt và environment để khách tự thấy site nào đang chiếm ghế. Giảm ticket đáng kể.
Tín hiệu lạm dụng
signal_type
Điều kiện phát hiện
EXCESS_CONCURRENT_SITES
Số fingerprint production hoạt động trong 7 ngày > maxActivations
SHARED_FINGERPRINT_ACROSS_LICENSES
Một fingerprint xuất hiện dưới ≥ 2 license khác chủ
FINGERPRINT_CHURN
≥ 5 fingerprint khác nhau trên cùng license trong 24 giờ
GEO_IMPOSSIBLE
Heartbeat từ ≥ 3 quốc gia khác nhau trong 1 giờ
REACTIVATION_THRASHING
≥ 10 chu kỳ activate/deactivate trong 7 ngày
Worker và thang leo thang
Worker detectLicenseAbuse quét cửa sổ heartbeat 7 ngày theo chu kỳ, dùng FOR UPDATE SKIP LOCKED như các worker sẵn có.
flowchart LR
  A[CLEAN] -->|1 tin hieu| B[WATCH]
  B -->|2 tin hieu 14 ngay| C[RESTRICTED]
  C -->|chi admin| D[SUSPENDED]
  B -->|het han| A
  C -->|admin go| A
WATCH chỉ ghi log và báo admin, khách không thấy gì. RESTRICTED chặn cấp download mới nhưng license vẫn validate hợp lệ, site khách vẫn chạy. Worker không bao giờ được tự đặt SUSPENDED — chỉ người thật quyết định, vì một false positive ở mức này là mất khách vĩnh viễn.
Invariant
• Heartbeat lỗi hoặc thiếu không bao giờ làm license invalid. Site khách có thể mất mạng, firewall chặn outbound, hoặc cron WP chết.
• Fingerprint không khớp không tự thu hồi activation. Khách đổi host hoặc migrate site là chuyện bình thường.
• Không ghi licenseKey plaintext vào license_heartbeats hay audit log, giữ đúng tiền lệ Phase 7.
• Redis chết → HTTP 503, không ghi heartbeat rác.
Acceptance (~30 gate)
Hai license khác chủ cùng fingerprint sinh đúng 1 signal. Năm domain trong 24 giờ trên license maxActivations = 1 sinh EXCESS_CONCURRENT_SITES. Staging không chiếm ghế production. Heartbeat sai key trả { valid: false } không lộ nguyên nhân. Leo thang tự động dừng ở RESTRICTED. RESTRICTED chặn POST /v1/downloads/request nhưng POST /v1/licenses/validate vẫn trả valid: true.
Phase 17 — Payment Fraud & Dispute Defense
Chặn chargeback, refund abuse và bot checkout mà không tạo thêm đường ghi state nào. Phụ thuộc Phase 9 (Stripe) và Phase 5 (entitlement).
Ràng buộc kiến trúc
Mọi thay đổi state ở phase này phải đi qua processAuthoritativePaymentEvent đã có. Không tạo authority thứ hai. Đây là ràng buộc dễ vi phạm nhất khi thêm dispute handling, và vi phạm nó là phá toàn bộ bảo đảm Phase 9 Round 3.
Migration (additive)
Bảng
Thay đổi
order_risk_assessments (mới)
order_id, score, factors_json, decision enum ALLOW/REVIEW/DENY, decided_by, decided_at, auto_released_at
refunds (mới)
Bảng đã nằm trong danh sách bảng lõi nhưng chưa tồn tại: payment_id, provider_refund_id, amount_minor, currency, reason, status
payment_disputes (mới)
payment_id, provider_dispute_id, status, amount_minor, opened_at, closed_at, outcome
entitlements
Tái dùng abuse_status của Phase 16, thêm giá trị PENDING_REVIEW
Risk scoring trước khi cấp quyền
Tiền vẫn thu bình thường — Stripe quyết định việc đó. Cái bị hoãn là quyền truy cập, không phải giao dịch.
Outbox ORDER_PAID vẫn phát nguyên như cũ. Worker entitlement-issuer đọc order_risk_assessments và cấp entitlement ở abuse_status = PENDING_REVIEW thay vì CLEAN khi decision = REVIEW. Không thêm nhánh outbox mới, không đổi status.
Factor đưa vào điểm:
• stripe.radar.risk_score — Stripe đã tính sẵn, dùng lại thay vì tự dựng
• Email domain dùng một lần (danh sách + heuristic MX)
• Tài khoản tạo dưới 10 phút trước khi mua
• ≥ 3 order khác thẻ cùng IP hash trong 24 giờ
• Lệch quốc gia giữa BIN thẻ và IP
• Giá trị đơn bất thường so với lịch sử tài khoản
SLA tự động nhả: PENDING_REVIEW quá 30 phút mà không có factor nặng (radar_high, disposable_email) thì worker tự chuyển sang CLEAN và ghi auto_released_at. Khách thật chờ nửa tiếng là chịu được; chờ vô thời hạn thì không.
Dispute và refund
Webhook Stripe
Hành động
charge.dispute.created
Entitlement → SUSPENDED, revoke internal license, audit ENTITLEMENT_SUSPENDED_DISPUTE
charge.dispute.closed outcome won
Khôi phục CLEAN, cấp lại license qua worker sẵn có
charge.dispute.closed outcome lost
Giữ SUSPENDED vĩnh viễn, ghi payment_disputes.outcome
charge.refunded
Thu hồi theo policy sản phẩm: REVOKE_IMMEDIATE hoặc REVOKE_AT_PERIOD_END
Mọi webhook trên đi qua đúng pipeline xác thực chữ ký, kiểm livemode, và ghi PaymentEvent có raw_payload_hash như Phase 9. Chữ ký sai → không một mutation nào.
Chống bot checkout
Rate limit ZSET tái dùng hạ tầng Phase 8, khóa theo ipHash + email + fingerprint, áp cho POST /v1/orders và POST /v1/orders/:id/payment-session. Thêm Cloudflare Turnstile ở trang checkout — Cloudflare đã nằm trong stack nên không thêm phụ thuộc mới.
Invariant
• Entitlement PENDING_REVIEW không cấp được download và không sinh internal license. Fail-closed.
• Không hệ thống nào được đặt decision = DENY sau khi order đã PAID mà không có audit log có actor người thật.
• Dispute webhook lặp lại xử lý idempotent qua @@unique([provider, externalEventId]) sẵn có.
• Risk score không bao giờ chặn việc thu tiền, chỉ hoãn việc cấp quyền.
Acceptance (~25 gate)
Dispute tạo đúng 1 lần suspend, webhook lặp không suspend lần hai. Dispute won khôi phục đầy đủ license và download. PENDING_REVIEW trả 403 trên POST /v1/downloads/request. Auto-release sau 30 phút hoạt động đúng và ghi auto_released_at. Webhook dispute chữ ký sai gây 0 mutation. Refund REVOKE_AT_PERIOD_END không cắt quyền ngay.
Phase 18 — Signed Update Channel & Kill Switch
Đây là đòn bẩy chống null thực sự: bản crack không có update, và không giả được update. Phụ thuộc Phase 8 và Phase 16.
Ký số gói cập nhật (Ed25519)
Backend ký sha256(file) || version || productId khi publish phiên bản. Plugin phía khách verify bằng public key nhúng sẵn trong mã nguồn.
Bảng
Thay đổi
product_versions
Thêm signature, signed_at, signing_key_id
signing_keys (mới)
key_id, public_key, algorithm, activated_at, retired_at — không lưu private key
Private key nằm trong KMS hoặc biến môi trường, tuyệt đối không vào database, giống cách LICENSE_KEY_ENCRYPTION_KEY đang được xử lý ở Phase 7. Fail-closed khi khởi động production nếu thiếu key.
Xoay khóa: hai key cùng hợp lệ trong cửa sổ chuyển đổi 90 ngày, plugin chấp nhận cả hai key_id. Không xoay khóa được là không dám xoay khi lộ.
Mối đe dọa được chặn: kẻ tấn công trỏ DNS hoặc chèn proxy để đẩy bản có backdoor vào site khách. Không có chữ ký thì kênh update chính là kênh RCE vào toàn bộ khách hàng cùng lúc. Giá trị bảo mật ở đây lớn hơn giá trị chống crack.
POST /v1/updates/check (Phase 8) mở rộng payload trả thêm signature và signingKeyId bên cạnh downloadUrl.
Kill switch có giới hạn
Khi abuse_status = SUSPENDED, POST /v1/updates/check trả { valid: false, featureGate: "deactivate_premium" }.
Ràng buộc cứng, phải viết vào spec và vào test:
• Chỉ tắt tính năng premium và hiển thị thông báo kèm đường liên hệ.
• Không xóa dữ liệu khách, không drop bảng, không xóa file.
• Không chặn admin đăng nhập WordPress, không làm trắng site.
• Không chèn quảng cáo, redirect, hay bất kỳ hành vi phá hoại nào.
• Nội dung khách đã tạo bằng plugin vẫn hiển thị bình thường ở frontend.
Một kill switch vượt quá những giới hạn này là phá hoại tài sản khách hàng và có thể bị kiện, kể cả khi khách thực sự dùng bản lậu.
Dry-run bắt buộc: KILL_SWITCH_DRY_RUN=true mặc định trong 30 ngày đầu ở production. Chỉ ghi log đáng lẽ đã gửi gì cho ai, không phát gì. Đủ để đo tỷ lệ false positive trước khi nó chạm khách thật.
Grace period
flowchart LR
  A[Entitlement het han] --> B[14 ngay an han]
  B --> C[Canh bao trong admin]
  C --> D[Ngung update moi]
  D --> E[Giu nguyen ban da cai]
Hết hạn không bao giờ tắt tính năng đột ngột. Khách đã trả tiền cho phiên bản họ đang chạy — họ giữ nó vĩnh viễn, đúng nguyên tắc releasedAt <= updatesUntil đã có từ Phase 8.
Audit
UPDATE_SIGNATURE_ISSUED, SIGNING_KEY_ROTATED, KILL_SWITCH_ISSUED, LICENSE_SUSPENDED. Mọi hành động thủ công ghi actor là người thật, không ghi system.
Acceptance (~20 gate)
Chữ ký hợp lệ verify pass, file sửa 1 byte verify fail. Hai signing key cùng hợp lệ trong cửa sổ chuyển đổi. Key đã retired_at bị từ chối. Dry-run không phát featureGate nào. Grace period đếm đúng 14 ngày. Worker không tự đặt SUSPENDED được (kế thừa gate Phase 16). Thiếu signing key ở production → API không khởi động.
Phase 19 — Personalized Build & Leak Tracing
Mỗi file khách tải về mang dấu vết truy ngược được. Khi bản null xuất hiện trên forum, biết nó rò từ order nào. Phụ thuộc Phase 8.
Migration (additive)
Bảng
Thay đổi
download_grants
Thêm watermark_token, build_artifact_key, build_status
personalized_builds (mới)
Cache theo (version_file_id, user_id): artifact_key, watermark_token, built_at, expires_at
Hai kênh watermark
Kênh nhìn thấy — răn đe. Header comment trong file chính: /** Licensed to: ORD-20260922-A7F3K — d***@example.com */. Dễ xóa, nhưng phần lớn người chia sẻ lại không xóa, và việc biết nó tồn tại đã làm giảm ý định chia sẻ.
Kênh ẩn — truy vết. watermark_token = HMAC(pepper, grantId) nhúng phân tán qua nhiều vị trí: thứ tự khóa trong file JSON cấu hình, tên biến sinh tự động trong file build, và một .build-manifest ẩn. Map watermark_token → grantId lưu trong DB; download_grants đã có sẵn userId, entitlementId, orderId nên không cần nhúng gì khác vào file.
Tuyệt đối không nhúng email thật, license key, hay user ID vào token. Token là con trỏ, không phải dữ liệu.
Quy trình đóng gói
Không đóng gói đồng bộ trong request tải. Giữ nguyên quy trình 3 bước của Phase 8, chèn personalization thành job async.
flowchart TD
  A[POST downloads request] --> B[Cap DownloadGrant<br/>FOR UPDATE]
  B --> C{Cache build<br/>con han?}
  C -->|co| D[Signed URL cho artifact]
  C -->|khong| E[Job packager]
  E --> F[Tai goc tu R2]
  F --> G[Inject watermark]
  G --> H[Upload artifact TTL 24h]
  H --> D
Artifact cá nhân hóa có lifecycle rule tự xóa sau 24 giờ. Cache build theo (version_file_id, user_id) sống 30 ngày để khách tải lại không phải build lại.
Hai chế độ cấu hình: WATERMARK_MODE=strict — không build được thì không cấp URL, trả 503, fail-closed. WATERMARK_MODE=best_effort — packager quá tải thì cấp file gốc và ghi build_status = SKIPPED. Bắt đầu bằng best_effort cho đến khi đo được tải trọng thật.
Truy vết
POST /admin/anti-piracy/trace — dán file hoặc đoạn code bị leak, hệ thống trích token và trả về grant, order, user, thời điểm tải. RBAC antipiracy.investigate, cấp cho admin và super_admin. Audit LEAK_TRACE_QUERIED ghi actor — endpoint này tra ra danh tính khách hàng nên bản thân nó cần được giám sát.
Giới hạn pháp lý
Với sản phẩm WordPress GPL, watermark là công cụ truy vết nguồn, không phải bằng chứng vi phạm bản quyền. Khách redistribute code GPL là hợp pháp. Kết quả trace chỉ dùng cho quyết định thương mại — ngừng bán, không gia hạn ưu đãi — chứ không dùng để đe dọa pháp lý. Riêng Figma UI kit và asset không GPL thì khác: ở đó watermark là bằng chứng dùng được.
Acceptance (~25 gate)
Token trích được từ file đã build. Hai khách khác nhau cho token khác nhau. Cùng khách tải hai lần cho cùng token. Artifact tạm hết hạn đúng TTL. strict mode fail-closed 503 khi packager chết, không ghi DownloadEvent rác. Token không chứa email hay key ở bất kỳ dạng nào. trace từ tài khoản non-staff trả 403.
Thứ tự triển khai
Không làm phase nào trong số này trước khi có khách thật và doanh thu thật. Chống cướp khi chưa có gì để cướp là lãng phí.
Phase
Điều kiện khởi động
Ước lượng
Giá trị
17 — Payment fraud
Ngay khi Stripe live chạy thật
2–3 tuần
Chặn mất tiền mặt
16 — License abuse
Sau Phase 12, ≥ 100 license đang hoạt động
3–4 tuần
Thu hồi doanh thu bị share
18 — Signed update
Trước khi plugin tự update phổ biến
2 tuần
Bảo mật kênh + chống null
19 — Watermark
Khi đã thấy bản null ngoài thị trường
3–4 tuần
Truy vết, răn đe
Phase 17 đi trước vì chargeback là mất tiền thật ngay, còn license bị share chỉ là doanh thu không thu được. Phase 18 đi trước Phase 19 vì rẻ hơn, nhanh hơn, và giá trị bảo mật cao hơn hẳn.
Phụ thuộc
flowchart LR
  P7[Phase 7<br/>Internal license] --> P16[Phase 16<br/>Abuse detect]
  P8[Phase 8<br/>Download] --> P16
  P8 --> P18[Phase 18<br/>Signed update]
  P8 --> P19[Phase 19<br/>Watermark]
  P9[Phase 9<br/>Stripe] --> P17[Phase 17<br/>Fraud]
  P5[Phase 5<br/>Entitlement] --> P17
  P16 --> P18
Phase 16 phải xong trước Phase 18 vì kill switch đọc abuse_status do Phase 16 tạo ra.
Hạ tầng tái dùng
Bốn phase này không thêm phụ thuộc hạ tầng mới nào đáng kể. Chúng dùng lại: Redis ZSET Lua rate limiter (Phase 8), outbox pattern (Phase 4), FOR UPDATE SKIP LOCKED worker (Phase 5), AES-GCM key handling (Phase 7), processAuthoritativePaymentEvent (Phase 9), và audit log xuyên suốt. Chỉ Phase 19 cần thêm compute cho packager — có thể dùng chính BullMQ worker hiện tại với queue riêng.
CI
Mỗi phase thêm một phaseNN-acceptance.ts theo đúng khuôn packages/database/scripts/, và một bước trong workflow. Tổng acceptance sau Phase 19 khoảng 100 gate mới, nâng chuỗi CI lên 12 bước acceptance. Đây lúc đó sẽ là vấn đề thời gian chạy — cân nhắc tách job song song theo domain thay vì chạy tuần tự.
Rủi ro và điều không làm
Rủi ro lớn nhất là false positive
Một khách thật bị khóa nhầm gây thiệt hại lớn hơn mười kẻ dùng lậu không bị chặn. Các tình huống bình thường dễ bị hiểu nhầm thành lạm dụng:
• Agency mua 1 license dùng cho site khách, migrate qua lại giữa staging và production
• Khách đổi hosting, fingerprint đổi theo
• Site dùng CDN multi-region, heartbeat ra nhiều quốc gia trong một giờ
• Backup restore làm xuất hiện hai site cùng fingerprint trong thời gian ngắn
• Dev local clone site production để debug
Vì vậy: tự động dừng ở RESTRICTED, dry-run 30 ngày, và mọi hành động chạm khách đều cần người duyệt.
Đo trước khi xây
Trước Phase 16, chạy 30 ngày chỉ thu thập heartbeat và không sinh tín hiệu nào. Nếu tỷ lệ license vượt ghế dưới 5%, toàn bộ Phase 16 không đáng làm — tiền đó nên đổ vào sản phẩm. Con số này cũng là cơ sở để chọn ngưỡng cho từng signal_type, thay vì đoán.
Dứt khoát không làm
• Không backdoor, không remote code execution qua kênh update. Chính chữ ký Ed25519 ở Phase 18 là thứ chặn điều này.
• Không thu thập nội dung database khách, danh sách người dùng, hay bất kỳ dữ liệu nào ngoài metadata kỹ thuật đã liệt kê.
• Không phá site, xóa dữ liệu, hay chặn admin đăng nhập trong bất kỳ kịch bản kill switch nào.
• Không reverse-engineer hay dùng private API của nhà cung cấp upstream — giữ đúng nguyên tắc đã chốt ở phần Elementor của PROJECT_CONTEXT.
• Không obfuscate PHP thuộc GPL.
• Không dùng kết quả watermark để đe dọa pháp lý khách hàng với sản phẩm GPL.
Câu hỏi còn mở
• Tỷ lệ sản phẩm GPL (theme, plugin WP) so với không GPL (Figma kit, asset) trong catalog? Con số này quyết định Phase 19 đáng đầu tư tới đâu.
• Có định bán cho thị trường EU không? Nếu có, phần GDPR của heartbeat cần làm kỹ hơn mức mô tả ở đây.
• Plugin phía khách do team này viết hay do đối tác? Nếu không kiểm soát được code phiên bản khách cài, Phase 18 và 19 đều không triển khai được.
