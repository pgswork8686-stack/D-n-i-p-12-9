# Workflow: weekly-marketing-review (v1.0.0)

Executable implementation: `packages/ai-core/src/workflows/weekly-marketing-review.ts`.
Triggered by `POST /v1/ai/executions` with `{ "workflow": "weekly-marketing-review", "tenantId": "<CLIENT tenant>" }`.

```text
load context            context.load                       READ
retrieve analytics      analytics.get_period_measures ×2   READ   (current week, previous week)
calculate KPI           metric registry (@nexus/utils)     COMPUTE
compare period          percentChange per metric           COMPUTE
identify anomalies      rule-based, min-volume guards      COMPUTE
generate recommendations rule-based; budget changes are proposals only
(optional) narrative    AI provider, untrusted-data wrapped, validated, fallback on failure
create report draft     report.create_draft                WRITE_LOW_RISK
```

Allowed tools: `context.load`, `analytics.get_period_measures`, `report.create_draft`,
`ads.update_budget` (WRITE_HIGH_RISK, only through `POST /v1/ai/executions/:id/actions`, which
always requires a human approval). The workflow itself never calls a high-risk tool.

Output contract: `WeeklyMarketingReview` in `packages/contracts/src/ai.ts` (schemaVersion 1.0),
validated by `validateWeeklyReview` before it is stored.

Anomaly rules:
- Base measures (spend, leads, customers, revenue): |change| ≥ 25% (≥ 50% = critical) when the
  previous week had enough volume.
- Derived metrics: only when they get worse (CPL/CPQL/CAC/CPC up, ROAS/CTR/CVR down) by ≥ 25%.
- Channel: spend with ≥ 20 clicks and 0 leads; channel CPL ≥ 2× the overall CPL (≥ 3 leads).
