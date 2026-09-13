# Phase 4 — Commerce Core

## Goal
Deliver a business-safe, concurrency-safe commerce foundation from active cart through order/payment state and transactional outbox, without implementing fulfillment yet.

## Entry criteria
- Phase 1 Foundation merged
- Phase 2 Identity/RBAC merged
- Phase 3 Catalog merged
- Catalog prices use integer minor units and authoritative backend pricing

## Required flow
`Cart ACTIVE -> Checkout -> Order PENDING_PAYMENT + Payment PENDING -> verified TEST callback -> Payment terminal state -> Order terminal state -> ORDER_PAID outbox`

## Core invariants
1. Backend ignores client-supplied totals/unit prices.
2. A cart can produce at most one order.
3. Same idempotency key + same fingerprint replays the same committed checkout result, including under concurrent requests.
4. Same idempotency key + different fingerprint returns conflict.
5. A cart line preserves the exact selected commercial offer (`priceId`).
6. Different offers for the same variant must not silently merge or overwrite each other.
7. If the selected price becomes inactive/deleted/wrong-currency/wrong-variant, checkout rejects; it never silently selects a replacement offer.
8. Cart mutations cannot modify a cart after checkout has claimed/converted it.
9. OrderItem financial/product snapshots are authoritative and immutable historical records.
10. Payment transitions are one-way from PENDING to one terminal winner.
11. Payment and Order terminal states must remain consistent in the same transaction.
12. ORDER_PAID is emitted at most once at the business level.
13. Outbox multi-worker processing must use concurrency-safe claims and owner-checked finalization.

## Price/offer identity
Preferred cart identity is `(cartId, variantId, priceId)` when multiple offers per variant are valid. If product/business policy later restricts one offer per variant, replacement must be explicit customer intent, never an implicit upsert side effect.

## Idempotent checkout
Scope: `checkout + userId + idempotencyKey`.
Fingerprint includes all fields that define checkout intent for this phase.

Concurrent same-key acceptance:
- 10 requests, same user, same key, same intent
- exactly 1 Order
- exactly 1 Payment
- all successful/replayed results resolve to the same order/payment IDs
- loser requests must not return an unrelated response or a false conflict after the winner has committed

## Checkout/cart serialization
Financial/catalog snapshot and cart claim must be protected against TOCTOU.
Cart write operations must verify ownership and `ACTIVE` status at write time using transaction/CAS/locking semantics.

Live race cases:
- checkout vs quantity update
- checkout vs add item
- checkout vs remove item

The losing mutation must not change a converted cart. Order snapshot must match the committed checkout view.

## Payment callback
- provider must be enabled only in allowed non-production/test environments for TEST provider
- webhook/event signature verification fails closed
- `PaymentEvent` uniqueness is scoped by `(provider, externalEventId)`
- duplicate/replayed event returns actual persisted state
- concurrent distinct terminal events produce one terminal winner

Acceptance cases:
- two concurrent distinct success events -> one transition, one ORDER_PAID
- success vs cancel -> consistent persisted terminal pair
- success then cancel -> remains paid/succeeded
- cancel then success -> remains cancelled/cancelled for that payment attempt

If Payment CAS succeeds but expected Order CAS cannot transition from the required state, do not commit an inconsistent pair; rollback or handle explicitly as a safe invariant violation.

## Transactional outbox
Claim mechanism for live runtime:
- PostgreSQL atomic claim
- `FOR UPDATE SKIP LOCKED` or equivalently safe database claim
- status -> PROCESSING
- `lockOwner` + lease timestamp

Unsafe fallback to `findMany(PENDING)` is allowed only in an explicitly injected/mock test adapter, never silently in live runtime.

Finalize with CAS:
- id = event.id
- status = PROCESSING
- lockOwner = current worker

Stale worker must not finalize after another worker has reclaimed the lease.

Retry behavior must match documentation. If exponential/backoff scheduling is claimed, implement an eligible-at timestamp and claim filter; otherwise document immediate polling retry honestly.

## Security / ownership
- customer cart/order reads and mutations scoped to authenticated user
- cross-user order access returns non-enumerating 404 where appropriate
- admin order APIs require `order.read`
- secrets/signature material never returned to client

## Migration rules
Phase 4 has not been deployed to production yet, so migration cleanup/folding is allowed before merge when it removes unnecessary destructive intermediate history. Once deployed, never drop/recreate idempotency/payment/order data merely to simplify schema evolution.

## In scope
Cart, CartItem offer identity, Checkout, Order/OrderItem snapshots, Payment TEST provider, PaymentEvent, idempotency, outbox foundation, RBAC/ownership, contracts/SDK/minimal acceptance UI, live acceptance tests.

## Out of scope
Entitlements, downloads, licenses, external allocations, production payment gateways, refunds/revoke implementation, CMS, n8n automation, Preview Engine implementation.

## Acceptance gates
At minimum retain existing Phase 4 gates and add:
1. same-key concurrent checkout
2. same variant + two offers causes no silent plan mutation
3. selected inactive/mismatched price rejects checkout
4. checkout vs cart mutation races
5. concurrent distinct payment-success events create exactly one ORDER_PAID
6. success vs cancel yields consistent terminal pair
7. stale outbox lease owner cannot finalize

Concurrency gates must hit live PostgreSQL. Worker/queue evidence must hit live Redis where applicable.

## Quality gates
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build --concurrency=2
pnpm worker:smoke
pnpm --filter @nexus/database acceptance:phase4
```

## Exit criteria
- latest review returns PASS
- no required BLOCKER/HIGH findings remain
- live race gates pass
- PR body contains current evidence only
- `ROADMAP.md` and `CURRENT_PHASE.md` are advanced to Phase 5 after merge
