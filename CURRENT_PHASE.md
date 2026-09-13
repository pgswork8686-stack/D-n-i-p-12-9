# CURRENT PHASE

## Phase
Phase 4 — Commerce Core

## Status
`NEED FIX / REVIEW ROUND 3`

## Active implementation branch
`feature/phase-4-commerce-core`

## Pull Request
PR #6 — `feat(commerce): Phase 4 Commerce Core - Cart, Repricing, Orders, Test Payment, and Outbox`

## Objective
Deliver a concurrency-safe and business-safe commerce foundation:

`Cart -> Checkout -> Order -> Test Payment -> verified callback -> Order PAID -> transactional outbox`

## Required focus before merge
- same-key concurrent checkout must replay the winner response rather than incorrectly returning conflict;
- cart line identity must preserve immutable selected `priceId`/offer semantics;
- unavailable/inactive/mismatched selected price must reject checkout, never silently fall back to another offer;
- cart mutation vs checkout race must not mutate a converted cart or create a stale financial snapshot;
- payment CAS losers must return actual persisted state and payment/order terminal states must stay consistent;
- outbox raw claim must fail closed outside explicitly mocked/test environments;
- outbox finalization must verify `status=PROCESSING` and `lockOwner=currentWorker`;
- retry/backoff claims in code/PR documentation must match implementation;
- test payment secret must be explicitly configured when the test provider is enabled;
- Phase 4 migration history must be clean before first deployment;
- concurrency acceptance must use live PostgreSQL, not mocked Prisma only.

## In scope
- Cart
- CartItem + selected Price identity
- Checkout
- Order + immutable OrderItem snapshots
- Payment attempt + TEST provider
- payment callback signature verification
- idempotency
- transactional outbox
- ownership/RBAC for commerce endpoints
- SDK/contracts/minimal commerce UI needed for acceptance
- live Phase 4 acceptance tests

## Explicitly out of scope
- Entitlement creation
- Elementor/provider allocation
- internal license keys
- license activation/deactivation APIs
- signed R2 downloads
- production payment providers
- CMS/SEO system
- n8n business automation
- preview engine implementation

## Merge rule
Do not merge PR #6 until review returns `PASS` and all BLOCKER/HIGH findings required for Phase 4 are closed.

## After PASS
1. Merge Phase 4.
2. Update `ROADMAP.md`.
3. Change this file to `Phase 5 — Entitlement Engine`.
4. Use `docs/phases/phase-05-entitlement.md` as the implementation contract.
5. Do not begin Phase 6 until Phase 5 review passes.
