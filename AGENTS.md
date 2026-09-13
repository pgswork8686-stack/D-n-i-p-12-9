# AGENTS.md

This repository is a digital product commerce platform. This file is mandatory reading for any implementation agent.

## Read order before ANY change
1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `ROADMAP.md`
4. `CURRENT_PHASE.md`
5. The matching file under `docs/phases/`
6. Relevant architecture/business/security docs under `docs/`
7. Existing implementation and latest PR review for the current phase

Do not begin coding until the current phase, scope, invariants, and explicit out-of-scope items are understood.

## Roles
- Implementation agent (Codex/Antigravity): implement, test, commit, push, update PR evidence.
- ChatGPT: reviewer/architect; review architecture, business logic, security, concurrency, migrations, acceptance evidence, and scope consistency.
- Do not merge a PR unless explicitly approved after review.

## Non-negotiable architecture rules
- PostgreSQL is the source of truth for business state.
- NestJS backend owns business-critical state transitions.
- Frontends must not directly mutate order, payment, entitlement, license, allocation, or fulfillment state.
- n8n is orchestration only; it must not write business-critical tables directly.
- V1 stays a NestJS modular monolith. Do not introduce microservices without an explicit architecture decision.
- Paid access is authorized through Entitlement. Do not design `order -> license` shortcuts.
- Private product packages must never be exposed as permanent public URLs.
- Payment success pages never mark an order paid; only a verified provider event may do so.
- Secrets, provider master credentials, private package URLs, and service-role keys must never be exposed to clients or committed to Git.

## Phase isolation
Implement only the phase named in `CURRENT_PHASE.md`.

If a current-phase implementation touches future-phase concerns:
- define the minimum interface/event/placeholder only when necessary;
- document the dependency;
- do not implement the future domain early.

Do not broaden scope to CMS, automation, affiliate, advanced search, extra payment providers, or infrastructure unless the current phase explicitly includes them.

## Business-critical invariants
For commerce, payment, entitlement, license, download, and fulfillment work:
- test happy path and failure path;
- test ownership/authorization boundaries;
- test idempotency;
- test concurrency/races against live PostgreSQL when state can be written concurrently;
- prefer database constraints/CAS/transactions over in-memory assumptions;
- financial and entitlement snapshots must not silently change identity or offer after selection;
- retries must be safe and must not create duplicates.

## Mandatory quality gates
Before reporting a phase complete, run the applicable repository gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build --concurrency=2
pnpm worker:smoke
```

For business-critical phases, also run the phase-specific live acceptance suite against real local PostgreSQL/Redis. Mock-only concurrency evidence is insufficient.

Report exact task/test/gate counts from the latest run. Do not copy stale counts from old PR descriptions.

## Git workflow
- Never implement features directly on `main`.
- Use a feature/docs branch.
- Prefer one PR per phase or coherent governance change.
- Do not create a new PR when instructed to continue an existing phase PR.
- Do not merge your own phase PR.
- After push and PR update, stop and wait for review when `CURRENT_PHASE.md` says review is required.

## Review severity
- `BLOCKER`: architecture/security/data-loss/business-integrity failure; cannot merge.
- `HIGH`: important business/security/concurrency/test defect; normally cannot merge until fixed.
- `MEDIUM`: maintainability/consistency/DX weakness.
- `LOW`: cleanup/cosmetic/documentation polish.

## Documentation maintenance
A phase is not complete if implementation changes architecture or business behavior but the relevant docs remain stale.

At phase transition, update at minimum:
- `ROADMAP.md`
- `CURRENT_PHASE.md`
- the phase spec and acceptance evidence
- `DECISIONS.md` if a durable architecture/business decision changed

Never silently rewrite historical decisions. Add a superseding decision instead.
