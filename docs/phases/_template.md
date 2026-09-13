# Phase Spec Template

Copy this file when defining a new phase. A phase must have explicit scope and acceptance before implementation begins.

# Phase N — Name

## Goal
What user/business capability this phase proves.

## Entry criteria
What must already be merged/configured before this phase starts.

## Required flow
Use an end-to-end flow, for example:
`event -> service -> authoritative DB transition -> outbox/response`.

## Data model
List models/fields/constraints/indexes that are required. Explain immutable identities and uniqueness rules.

## Business invariants
List rules that must remain true under retries, concurrency, stale data, and failures.

## API/contracts
List required endpoints, DTOs/contracts, auth/permissions, and error semantics.

## Security
Define ownership, RBAC, secret boundaries, rate limits, signed requests/URLs, and information that must never reach the client.

## Idempotency & concurrency
Define idempotency scope/key/fingerprint and required race behavior. State where database constraints/CAS/locks/transactions are required.

## Failure semantics
Define expected behavior for dependency failure, retries, partial work, stale states, and rollback.

## Observability & audit
Define audit events, correlation IDs, structured logs, metrics/alerts if applicable.

## In scope
Explicit list.

## Out of scope
Explicit list. Future features must not leak into implementation.

## Tests
- unit tests
- integration tests
- ownership/RBAC tests
- failure tests
- live PostgreSQL/Redis concurrency tests where required

## Acceptance gates
Number every gate and make it objectively assertable.

## Quality gates
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build --concurrency=2
pnpm worker:smoke
```
Add phase-specific acceptance commands.

## Migration requirements
State whether this phase is pre-production/fresh-data safe, whether destructive migrations are forbidden, and how rollback/backfill is handled.

## PR evidence required
- exact commands and latest counts
- runtime/live evidence
- known limitations
- migration notes
- no claims for unimplemented behavior

## Exit criteria
Define what `PASS` means and which docs must be updated before moving `CURRENT_PHASE.md` forward.
