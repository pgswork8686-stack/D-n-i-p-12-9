# Project Documentation Index

This directory contains implementation contracts and durable project rules. Agents should not treat old PR descriptions as the primary roadmap.

## Read first
1. `/AGENTS.md`
2. `/PROJECT_CONTEXT.md`
3. `/ROADMAP.md`
4. `/CURRENT_PHASE.md`
5. Current phase spec under `docs/phases/`

## Architecture
- `architecture/preview-engine.md` — Live Preview architecture and anti-clone risk controls

Future architecture docs should be split by durable domain boundary rather than by temporary implementation task.

## Business
- `business/project-input-checklist.md` — business inputs that must be provided/decided before dependent phases can be considered production-ready

## Phases
- `phases/_template.md` — required structure for new phase specs
- `phases/phase-04-commerce.md` — current Commerce Core acceptance contract
- `phases/phase-05-entitlement.md` — prepared next-phase implementation contract

## Governance
Root-level governance documents:
- `/AGENTS.md` — rules for implementation agents
- `/ROADMAP.md` — implementation sequence and product milestones
- `/CURRENT_PHASE.md` — exactly what may be implemented now
- `/DECISIONS.md` — durable architecture/business decisions

## Documentation rule
If code and docs disagree on a durable business rule, do not guess. Stop implementation of that disputed rule, surface the conflict in the PR, and resolve the decision explicitly before broadening the implementation.
