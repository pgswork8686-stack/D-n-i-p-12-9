# Apache Superset (Phase 19)

Superset is the BI layer for the marketing warehouse (`analytics` schema). It runs as an
**external service** from the official `apache/superset` image. It is not forked, not vendored and
not embedded in the Next.js apps.

| Superset is used for | Superset is NOT used for |
|---|---|
| Dashboards, charts, semantic metrics | CRM or customer records |
| Read-only SQL exploration of `analytics.*` | Transactions, payments, orders, licenses |
| (Future) AI analytics bridge through Superset MCP | Authentication / source of truth for users |

## Topology

```text
platform PostgreSQL ──(superset_ro, SELECT on analytics.* only)──► Superset ◄── superset-db (own metadata DB)
                                                                       ▲
                                                                 superset-redis (cache)
```

- **Separate metadata DB**: Superset's users, dashboards and saved queries live in
  `superset-db`, never in the platform database.
- **Read-only warehouse access**: `sql/create-readonly-role.sql` creates `superset_ro` with
  `USAGE` + `SELECT` on schema `analytics`, nothing in `public`, `default_transaction_read_only = on`
  and a 30 s statement timeout. The init script refuses any `ANALYTICS_DATABASE_URI` that does not
  use this role.
- **Secrets**: only in `infra/superset/.env` (gitignored) or the deployment secret store.
  `superset_config.py` raises at start-up if `SUPERSET_SECRET_KEY` (32+ chars) or
  `SUPERSET_METADATA_DB_URI` is missing or a placeholder. No Superset credential is ever passed
  to the web, portal or admin frontends (no `NEXT_PUBLIC_SUPERSET_*`).

## Run locally

```bash
cp infra/superset/.env.example infra/superset/.env      # fill in real values
psql "$DATABASE_URL" -v ro_password="$ANALYTICS_RO_PASSWORD" -f infra/superset/sql/create-readonly-role.sql
docker compose -f infra/superset/docker-compose.superset.yml --env-file infra/superset/.env up -d
# open http://127.0.0.1:8088 (bound to localhost only)
```

## Metrics: one source of truth

Derived KPIs (CTR, CPC, CPL, CPQL, CAC, ROAS, CVR) are defined once in
`packages/utils/src/analytics-metrics.ts`. `pnpm analytics:superset-metrics` writes
`metrics/marketing-metrics.json`, which you import as dataset metrics on
`analytics.fact_marketing_daily`. Do not hand-write formulas in charts.

## Tenant isolation inside Superset (required before sharing dashboards)

Every warehouse table has `client_id`. For each client role create a Row Level Security rule:

```text
Filter type: Regular   Tables: all analytics fact/dim tables   Roles: client_<slug>
Clause:      client_id = '<tenant uuid>'
```

Platform staff roles get no RLS filter. Never rely on dashboard filters for isolation; RLS is
applied server-side to every query, including SQL Lab, charts and (future) MCP calls.

## Production notes

- Put Superset behind the same SSO/IdP as the admin app, `SUPERSET_ENV=production` (secure
  cookies), HTTPS only. Port 8088 is bound to 127.0.0.1 in the compose file.
- Give SQL Lab only to staff analysts. Client roles get dashboards only.
- Back up `superset-db` separately from the platform database.
- Upgrade by bumping the pinned image tag after reading the Superset release notes.
