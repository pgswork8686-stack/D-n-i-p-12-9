# Phase 19 — AI Marketing OS & Analytics foundation

```text
Users / Admin
      │
Web / Portal / Admin  (UI only; no KPI formulas, no tenant filtering, no secrets)
      │
NestJS API ── TenantAccessService (membership-based isolation, 404 on foreign tenants)
      ├── AI module ── packages/ai-core (skills, tool policy, workflows, provider abstraction)
      │                   └── ports → analytics read service, context store, report drafts
      └── Analytics module ── read API + POST /internal/analytics/ingest (HMAC, n8n)
                                  │
                PostgreSQL: public (commerce, AI audit, tenants) | analytics.* (warehouse)
                                  │
                         Apache Superset (external, superset_ro read-only) → MCP (Phase 20)
```

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Code location | `packages/ai-core` (code) + `ai/` (skills, contexts, workflow specs, evals) | Content is reviewed like docs; enforcement is typed and tested; API and tests share it |
| Contracts | `packages/contracts/src/{ai,analytics}.ts`, SDK in `packages/sdk` | Existing convention (no separate ai-contracts package needed) |
| Skills | File-based, immutable at runtime, hash recorded per execution | Versioned with code; Agent Skills compatible |
| Contexts | DB, append-only versions (trigger), optimistic `baseVersion` | Per tenant, editable at runtime, auditable, never silently overwritten |
| Executions | `ai_executions` + `ai_execution_steps` + `ai_action_approvals` + `ai_report_drafts` | Full audit trail with redacted inputs/outputs |
| Tenancy | `tenants` (ORGANIZATION → CLIENT) + `tenant_members` | No tenant concept existed; analytics must be owned by a client |
| Warehouse | Same PostgreSQL, separate `analytics` schema (Prisma multiSchema) | V1 simplicity with a hard boundary: Superset's role can only read `analytics` |
| Metrics | `packages/utils/src/analytics-metrics.ts` | One authoritative formula set for API, AI and Superset (generated metrics JSON) |
| Model provider | `AiProvider` interface; default `none` | Workflows are deterministic; a model only writes narrative text, validated, with fallback |

## Data ownership

- Commerce, payments, licenses, identity: `public`, written only by the API/worker (unchanged).
- Marketing facts: `analytics.*`, written only by `AnalyticsIngestService` from signed connector
  batches; every row has `client_id` (FK → `analytics.dim_client` → `public.tenants`).
- Raw batches are kept (`analytics.raw_ingest_batches`) for idempotency and replay evidence.
- AI outputs are drafts (`ai_report_drafts`); nothing is published or spent automatically.

## Security rules

1. Tenant comes from the authenticated user → `TenantAccessService` → query filter. Foreign
   tenant ids return 404. Tested: client A cannot read client B (API, AI executions, contexts).
2. Ingestion: HMAC (`X-Nexus-*` headers), ±5 min timestamp, Redis replay protection,
   `(source, idempotencyKey)` idempotency with payload hash (409 on mismatch), 256 KB / 500
   records limits, strict per-kind schema, derived KPI fields rejected, audit log per batch.
3. AI tools have risk classes. `WRITE_HIGH_RISK` requires a human approval bound to the exact
   payload hash, approved by a different user (enforced in code and by a DB CHECK). Phase 19
   high-risk tools are dry-run stubs (no ads/budget/pricing mutation exists).
4. No arbitrary SQL tool, no DB credentials to models, no MCP `execute_sql` by default.
5. Untrusted data (analytics rows, context text, fetched content) is wrapped and never treated
   as instructions; model output is schema-validated and redacted.
6. Secrets: context and skill files reject secret-like content; execution inputs, steps,
   approvals and reports are stored through `redactSecretsDeep`; provider keys only in
   server env (NEXT_PUBLIC_* AI keys are rejected).
7. Fail closed: production refuses a configured AI provider without a real key (AI disabled,
   503); Superset refuses to start without secrets; invalid skill files stop API start-up.

## API

| Method | Path | Permission |
|---|---|---|
| POST | `/internal/analytics/ingest` | HMAC service auth (n8n) |
| GET | `/v1/analytics/clients · overview · campaigns · funnel · metrics` | `analytics.read` + membership |
| GET/POST | `/v1/admin/tenants`, `/v1/admin/tenants/:id/members` | `analytics.manage` |
| GET | `/v1/ai/status · skills · workflows · tools` | `ai.read` |
| GET/POST | `/v1/ai/contexts`, `/v1/ai/contexts/:id/versions`, `/v1/ai/contexts/versions` | `ai.read` / `ai.context.manage` |
| POST/GET | `/v1/ai/executions`, `/v1/ai/executions/:id` | `ai.execute` / `ai.read` |
| POST | `/v1/ai/executions/:id/actions` | `ai.execute` (high-risk → approval) |
| GET/POST | `/v1/ai/approvals`, `/v1/ai/approvals/:id/decision` | `ai.read` / `ai.approve` |
