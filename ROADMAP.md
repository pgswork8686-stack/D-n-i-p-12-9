# ROADMAP

This roadmap is the implementation sequence, not a promise to build every possible platform feature before validating a real sale.

## Product milestone rule
The platform must prove real vertical slices early:

`browse -> cart -> checkout -> payment -> order paid -> entitlement -> fulfillment -> customer can access again later`

Do not optimize for completing many horizontal subsystems while no product can complete its lifecycle.

## DONE
- Phase 1 — Foundation: monorepo, Docker, PostgreSQL, Redis, storage abstraction, health checks, worker plumbing
- Phase 2 — Identity, Authentication & RBAC
- Phase 3 — Catalog & Admin Product Foundation

## CURRENT
### Phase 4 — Commerce Core
Status: PR #6 under review/fix cycle.

Scope:
- cart
- immutable price/offer selection
- checkout
- order snapshots
- test payment provider
- payment state machine
- idempotency/concurrency
- transactional outbox

No entitlement/license/download/production payment implementation in Phase 4.

## NEXT
### Phase 5 — Entitlement Engine
Create the authorization layer from paid `OrderItem` to fulfillment. Duplicate/replayed events must never create duplicate entitlement.

### Phase 6 — Digital Download Vertical Slice
Prove one real sellable product lifecycle:
`PAID -> Entitlement ACTIVE -> download request -> entitlement check -> short-lived signed private object URL`.

### Phase 7 — Staging / Production Foundation
Deploy the real architecture with Cloudflare + Coolify/Docker, private DB/Redis, R2, Supabase production auth, secrets, backup/restore, health/monitoring, and CI gates.

### Phase 8 — First Production Payment Provider
Integrate one production provider only. Signed webhooks, idempotency, reconciliation, refund/revoke semantics. Add more providers only after the first is stable.

### Phase 9 — External Managed License Vertical Slice
Initial target: Elementor-style managed allocation.
`PAID -> Entitlement -> customer domain -> Allocation PENDING -> admin/provider handling -> ACTIVE`.
Use `MANUAL_EXTERNAL` when an official provider automation path is unavailable. Do not reverse-engineer private APIs or automate login bots.

### Phase 10 — Internal License Engine
License key issuance/validation, normalized domain activations, activation limits, deactivate/validate flows.

### Phase 11 — Customer Portal Completion
Dashboard, orders, entitlements, downloads, licenses/activations, notifications, account/security states.

### Phase 12 — Preview Engine
ThemeForest-style Live Preview with protected preview sessions, private demo runtime, gateway access, and optional stronger remote-rendered preview for premium assets. See `docs/architecture/preview-engine.md`.

## LATER
These are valuable but not on the critical path to proving commerce + fulfillment:
- CMS + SEO content system
- n8n/AI content automation
- affiliate
- membership growth features
- advanced search/recommendations
- multiple payment providers
- broader service/hosting control-plane features

## Explicitly deferred
- microservices migration
- Kubernetes
- multi-region database
- mobile app
- Zalo mini app

These require a separate architecture decision and demonstrated product need.
