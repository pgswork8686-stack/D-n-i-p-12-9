## Phase / Scope
- Current phase:
- Branch:
- Related phase spec:
- Explicitly out of scope:

## Objective
Describe the user/business capability this PR proves.

## Architecture / Business Invariants
List the critical invariants this PR must preserve, especially around:
- source of truth
- ownership/RBAC
- idempotency
- concurrency
- immutable offer/financial/entitlement identity
- secret/private asset boundaries

## Implementation Summary
Describe what actually changed. Do not claim behavior that is not implemented.

## Database / Migration
- Models/constraints/indexes changed:
- Destructive migration? Yes/No
- Safe for already-deployed production data? Explain.
- Backfill/rollback notes:

## Security
- Auth/permissions:
- Secret handling:
- Webhook/signature handling if applicable:
- Private file/provider credential exposure review:

## Idempotency / Concurrency Evidence
For business-critical state, list live race tests and database invariants. Mock-only evidence is not sufficient where the phase spec requires live PostgreSQL/Redis.

## Acceptance Gates
List every phase-specific acceptance gate with PASS/FAIL and exact evidence/counts from the latest run.

## Quality Gates
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build --concurrency=2`
- [ ] `pnpm worker:smoke`
- [ ] phase-specific live acceptance suite

Exact latest counts:
- lint tasks:
- typecheck tasks:
- test suites/tests:
- build tasks:
- acceptance gates:

## Documentation
- [ ] Phase spec matches implementation
- [ ] PR contains no stale claims/counts
- [ ] `DECISIONS.md` updated if a durable decision changed
- [ ] `ROADMAP.md` / `CURRENT_PHASE.md` updated only when phase transition is actually approved

## Known Limitations
List real limitations without hiding them behind future work.

## Review Request
Do not merge automatically. Wait for independent review and explicit PASS for the phase.
