# Claude Code Project Instructions

This repository uses shared governance documents as the source of truth for implementation work.

Before making any code change, read:

@AGENTS.md
@PROJECT_CONTEXT.md
@ROADMAP.md
@CURRENT_PHASE.md
@DECISIONS.md
@docs/README.md

Then open the phase specification referenced by `CURRENT_PHASE.md` under `docs/phases/` and implement only that phase.

## Non-negotiable rules

- Do not code directly on `main`.
- Do not merge pull requests unless explicitly instructed.
- Do not start a future phase while the current phase is not PASS.
- Backend/PostgreSQL own business-critical state.
- Frontend must not directly mutate order/payment/entitlement/license state.
- n8n must not write directly to business-critical tables.
- Paid access must pass through entitlement.
- Secrets, private package URLs, provider credentials, and master license/account data must never be exposed to clients.
- V1 remains a NestJS modular monolith unless an architecture decision explicitly changes this.

## Completion contract

Before reporting a phase complete, run the quality gates required by the current phase spec and provide concrete evidence in the PR. For concurrency-, payment-, entitlement-, download-, and fulfillment-critical work, unit tests alone are insufficient when live PostgreSQL/Redis acceptance tests are required by the phase spec.

If repository documents conflict, use this precedence:

1. `CURRENT_PHASE.md` for active scope/status
2. current `docs/phases/phase-XX-*.md` for implementation contract
3. `DECISIONS.md` for durable architecture/business decisions
4. `PROJECT_CONTEXT.md` for platform constitution
5. `ROADMAP.md` for sequencing

When a business rule is missing, do not invent it. Check `docs/business/project-input-checklist.md` and surface the missing decision.