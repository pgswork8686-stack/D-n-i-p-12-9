# Project Governance Rule

Always follow the repository governance and current phase boundary before making code changes.

Required context:
- @/AGENTS.md
- @/PROJECT_CONTEXT.md
- @/ROADMAP.md
- @/CURRENT_PHASE.md
- @/DECISIONS.md

Before implementation:
1. Read the files above.
2. Identify the current phase from `CURRENT_PHASE.md`.
3. Read the matching spec under `docs/phases/` and any architecture/business docs it references.
4. Inspect the existing implementation and the latest review/comments on the active phase PR.
5. Implement only the current phase. Do not start future phases or add unrelated platform features.

Non-negotiable execution rules:
- PostgreSQL/backend remain authoritative for business state.
- Preserve idempotency, concurrency, ownership/RBAC, secret boundaries, and immutable purchased-offer/right semantics.
- Do not expose private product packages, provider master credentials, service-role secrets, or permanent private asset URLs.
- For business-critical race behavior, use live PostgreSQL/Redis acceptance evidence when required by the phase spec; mock-only evidence is insufficient.
- Run the repository quality gates and phase acceptance gates before reporting completion.
- Update PR evidence with current counts only; do not copy stale claims.
- Do not merge the phase PR yourself. Stop after push/PR update when the phase requires independent ChatGPT review.

If code, PR text, and project docs disagree on a durable business rule, do not guess. Surface the conflict and resolve the governing decision before expanding implementation.
