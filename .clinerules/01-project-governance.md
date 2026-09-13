# Cline Workspace Governance

Before editing code in this repository:

1. Read `AGENTS.md`.
2. Read `PROJECT_CONTEXT.md`.
3. Read `ROADMAP.md`.
4. Read `CURRENT_PHASE.md`.
5. Read `DECISIONS.md`.
6. Open the current phase specification under `docs/phases/` referenced by `CURRENT_PHASE.md`.
7. Inspect the existing implementation and current PR before writing code.

## Phase boundary

Implement only the current phase. Do not start future-phase functionality while the current phase status is not PASS.

If a future domain is required for an interface boundary, create only the minimum contract or placeholder needed and document the dependency. Do not implement the future domain.

## Architecture rules

- PostgreSQL is the source of truth.
- Backend owns business-critical state transitions.
- Frontend must not directly change order, payment, entitlement, fulfillment, license, or allocation state.
- n8n is orchestration only and must not directly write business-critical tables.
- All paid access goes through entitlement.
- Never expose private ZIP URLs, secrets, service-role keys, provider credentials, or upstream master license/account data.
- Keep V1 as a NestJS modular monolith unless `DECISIONS.md` explicitly changes that decision.

## Git and review workflow

- Never implement directly on `main`.
- Use a feature/fix/docs branch and PR.
- Do not merge your own implementation PR unless explicitly instructed.
- Stop after pushing the completed work and updating the PR with test evidence.
- The phase advances only after independent review returns PASS.

## Validation

Run all quality gates required by the active phase spec. For payment, concurrency, outbox, entitlement, download, and fulfillment invariants, provide live acceptance evidence when the phase spec requires it.

If a business rule is unclear, consult `docs/business/project-input-checklist.md`; do not invent pricing, licensing, refund, fulfillment, or payment policy.