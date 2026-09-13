# Preview Engine Architecture

## Purpose
Provide ThemeForest-style Live Preview while protecting distributable source/package and raising the cost of automated cloning/scraping.

This document defines architecture only. Preview implementation is not part of the current Commerce phase.

## Security reality
A browser-visible design cannot be made impossible to visually copy. Pixels can be screenshotted, inspected by AI vision, or manually recreated.

The security objective is therefore:
1. never expose the private product package through preview;
2. avoid direct public access to demo runtimes where practical;
3. reduce automated scraping/hotlinking/session abuse;
4. prevent accidental exposure of source maps, private assets, credentials, admin endpoints, provider tokens, and distributable ZIPs;
5. optionally render premium demos remotely so client browsers receive pixels/streamed output rather than the original site DOM/CSS/JS.

Do not market this as 100% anti-clone protection.

## Required high-level flow
`Product Detail -> Live Preview -> POST preview session -> signed short-lived preview token -> preview gateway -> private demo runtime`

Suggested host:
`preview.<project-domain>`

## Separation of security domains
Preview runtime and distributable product package are independent.

### Preview runtime may contain
- demo content
- demo media optimized for preview
- sanitized demo database
- production-built/minified frontend assets when STANDARD mode is used

### Preview runtime must never contain/expose
- original distributable ZIP URL/storage key
- package download credentials
- service-role keys
- provider master account/key/token
- production database credentials
- customer data
- license signing secrets/private keys
- source maps in production preview
- internal admin/debug endpoints

## Preview modes

### STANDARD
Use for lower-risk/common assets.

`browser -> preview gateway -> isolated demo runtime`

Controls:
- short-lived signed preview session
- gateway-only/public-edge access where practical
- Cloudflare WAF/bot/rate-limit controls
- noindex/noarchive/nosnippet headers
- robots disallow
- CSP/frame-ancestors policy
- disable directory listing/debug/source maps
- production minification
- asset hotlink protection where useful
- session/IP/device risk signals without treating IP binding as an absolute identity guarantee
- demo/admin login disabled
- sensitive server endpoints blocked

STANDARD mode does not prevent a capable browser extension from observing client-delivered DOM/CSS/JS. It is risk reduction, not source secrecy.

### PROTECTED
Use for high-value/premium assets when stronger source protection justifies infrastructure cost.

`browser input -> preview gateway -> isolated remote Chromium/session -> rendered pixels/stream -> browser canvas/player`

The customer browser should not receive the underlying theme DOM/CSS/JS as the demo itself. Interaction events are forwarded to the remote browser; output is streamed back via an appropriate remote-rendering protocol (for example WebRTC-based or equivalent controlled streaming architecture).

PROTECTED mode still cannot prevent visual recreation from pixels/screenshots.

## Session model
Suggested PreviewSession fields:
- id
- productId/demoId
- userId nullable for guest previews
- mode STANDARD/PROTECTED
- token hash/jti
- status
- createdAt
- expiresAt
- revokedAt nullable
- lastSeenAt
- risk metadata (non-secret, minimized)

Rules:
- token TTL short (for example 10–30 minutes; final value set by product policy)
- token is scoped to one preview/demo
- suspicious reuse/rate anomalies may revoke/challenge
- session creation is rate-limited
- do not store unnecessary fingerprinting data

## Demo runtime isolation
Prefer private/internal network reachability for actual demo runtimes:

`Internet -> Cloudflare/preview gateway -> private demo runtime`

Avoid directly publishing `theme-a.demo.example.com` if that URL bypasses the gateway/session controls.

For containerized demos:
- no Docker socket exposure
- no host filesystem mounts containing product packages/secrets
- read-only filesystem where feasible
- resource limits
- egress restrictions where practical
- per-demo/per-session isolation appropriate to mode
- reset/reseed mechanism so customer interactions do not permanently alter the canonical demo

## WordPress/Elementor demos
Treat the demo WordPress installation as disposable preview infrastructure, not as the distributable product.

Controls:
- disable WP admin/customer login exposure unless explicitly required for a controlled demo use-case
- use demo-only credentials not shared with production/provider systems
- block XML-RPC/admin APIs if not required
- sanitize uploads/database
- no real customer/provider secrets
- reset state periodically or per session for mutable demos

## Responsive preview toolbar
Marketplace UI may expose:
- Back to product
- Product name
- Desktop / Tablet / Mobile
- Buy Now

In STANDARD mode viewport controls may resize the gateway frame safely.
In PROTECTED mode viewport controls should change the remote browser viewport itself.

Typical viewport presets may be configured by product UX, not hard-coded as a security rule.

## Anti-bot / anti-scrape controls
Use multiple layers rather than User-Agent blocking alone:
- Cloudflare WAF/bot signals
- per-IP/account/session rate limits
- Turnstile/challenge on suspicious behavior
- short-lived signed sessions
- request anomaly monitoring
- hotlink controls
- robots + X-Robots-Tag
- no public directory indexes

Do not assume robots directives prevent malicious scraping; they are crawler policy signals only.

## Watermark / forensic options
Optional session-specific visual or asset fingerprinting may help investigate leaked previews. It is not a primary protection control and must not expose sensitive identifiers.

## Product package download remains separate
Download flow belongs to Entitlement/Download Engine:
`Customer -> download request -> auth -> entitlement/version check -> rate limit -> short-lived signed private object URL -> download event log`

Preview session possession must never authorize a package download.

## Observability
Track at minimum:
- session creation/revocation/expiry
- product/demo ID
- mode
- gateway errors
- abnormal rate/reuse events
- remote runtime allocation/release for PROTECTED mode

Do not log preview tokens, auth bearer tokens, cookies, provider secrets, or private package URLs.

## Capacity note
PROTECTED mode is materially more expensive because remote Chromium sessions consume CPU/RAM and streaming resources. Do not enable it globally by default. Support per-product preview policy:
- STANDARD
- PROTECTED
- DISABLED

## Future implementation acceptance
When Preview Engine phase begins, acceptance should include:
1. direct demo-runtime origin is not publicly usable/bypassable under intended deployment;
2. expired/revoked preview tokens fail closed;
3. preview session cannot download private product package;
4. source maps/private credentials are absent from preview responses;
5. rate limits/challenges behave as designed;
6. STANDARD and PROTECTED mode behavior is explicitly tested;
7. teardown/reset prevents cross-customer state leakage in mutable demos;
8. no real provider/customer secrets exist inside demo images/databases.
