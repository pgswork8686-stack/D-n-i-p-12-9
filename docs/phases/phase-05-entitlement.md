# Phase 5 — Entitlement Engine

## Goal
Create the authoritative authorization layer between a paid OrderItem and every later fulfillment mechanism.

The invariant is not `Order -> License`.
The invariant is:
`Order -> OrderItem -> Entitlement -> fulfillment strategy`.

## Entry criteria
- Phase 4 merged and PASS
- Payment/Order terminal state consistency proven
- ORDER_PAID outbox is concurrency-safe and replay-safe

## Required flow
`ORDER_PAID outbox -> load paid Order -> iterate eligible OrderItems -> create/reconcile Entitlement -> ACTIVE/PENDING according to fulfillment policy`

## Core invariant
A fulfilled OrderItem produces at most one logical Entitlement for the same entitlement identity.

Recommended database constraint:
- `sourceOrderItemId` unique for one-entitlement-per-order-line products
or an explicit composite identity if business rules later require multiple entitlements from one OrderItem.

Do not rely only on checking before insert; enforce uniqueness at the database level and recover safely from races/replays.

## Suggested model
Entitlement should support at least:
- id
- userId
- sourceOrderItemId
- productId
- variantId
- fulfillmentType
- status
- startsAt
- expiresAt nullable
- updatesUntil nullable
- supportUntil nullable
- maxActivations nullable
- metadata
- createdAt/updatedAt

Suggested statuses:
- PENDING
- ACTIVE
- SUSPENDED
- EXPIRED
- REVOKED

Exact enum/fields may be adjusted if implementation evidence shows a cleaner domain model, but the authorization semantics must remain explicit.

## Snapshot rule
Entitlement terms must be derived from the purchased OrderItem/offer/license-plan snapshot, not from whatever the catalog happens to contain later.

A future catalog change must not silently alter a customer's historical purchased rights.

If Phase 4 OrderItem does not yet snapshot all terms required to construct an entitlement, Phase 5 must explicitly add the necessary immutable purchase snapshot rather than reading mutable catalog state forever.

## Fulfillment separation
Phase 5 authorizes rights; it does not implement each fulfillment mechanism.

Examples:
- DIGITAL_DOWNLOAD -> Entitlement ACTIVE, later Phase 6 creates signed download access
- EXTERNAL_MANAGED -> Entitlement ACTIVE/PENDING per policy, later allocation workflow handles domain/provider activation
- INTERNAL_LICENSE -> Entitlement authorizes later key/activation issuance
- MANUAL_SERVICE -> Entitlement represents purchased service right; operational workflow may remain manual

## Ownership/RBAC
- customers may read only their own entitlements
- admin/support read requires explicit permission
- mutation/revoke/suspend requires elevated explicit permission
- user ownership is derived from the paid order, not trusted from client payload

## Idempotency & concurrency
Replay ORDER_PAID 10 times:
- no duplicate entitlement
- same logical entitlement ID remains authoritative

Concurrent workers processing the same logical order line:
- database constraint prevents duplicates
- loser resolves/reloads the winner safely

No downstream fulfillment event should be emitted more than once at the business level unless intentionally versioned/retryable.

## Audit/outbox
Create audit evidence for entitlement creation and privileged status changes.
If downstream fulfillment is event-driven, create its outbox event in the same transaction as the entitlement state that authorizes it.

## Expiry semantics
Do not implement ambiguous expiration behavior.
Before production, business input must define whether expiration affects:
- runtime use
- updates
- support
- downloads
- new activations

These may have different dates. `expiresAt`, `updatesUntil`, and `supportUntil` must not be treated as synonyms unless business policy explicitly says so.

## In scope
- Entitlement model/migration
- creation from paid order items
- read APIs for customer/admin
- ownership/RBAC
- replay/concurrency safety
- audit/outbox handoff foundation
- immutable purchased-right snapshot support required by Entitlement
- live PostgreSQL acceptance tests

## Out of scope
- signed R2 URL generation
- internal license key generation
- provider allocation implementation
- production payment provider
- customer-facing polished portal UI
- CMS/n8n/Preview Engine

## Acceptance gates
1. One eligible paid OrderItem -> exactly one Entitlement.
2. Replay same ORDER_PAID 10x -> still exactly one Entitlement.
3. Concurrent workers on same OrderItem -> exactly one Entitlement.
4. Different OrderItems produce distinct entitlements.
5. Another customer cannot read entitlement.
6. Unauthorized admin role cannot mutate entitlement.
7. Catalog price/name/license-plan edits after purchase do not silently change purchased entitlement terms.
8. Entitlement creation + downstream outbox/audit is transactionally consistent.
9. Unsupported/unknown fulfillment type fails closed; no guessed access is granted.

## Quality gates
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build --concurrency=2
pnpm worker:smoke
```

Add `acceptance:phase5` against live PostgreSQL/Redis when Phase 5 is implemented.

## Exit criteria
Phase 5 passes independent review and provides a stable authorization contract for Phase 6 Digital Download without implementing download transport inside Entitlement.
