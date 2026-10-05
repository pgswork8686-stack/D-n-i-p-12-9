# Superset MCP integration contract (Phase 19 design, not yet productionised)

Apache Superset ships an MCP (Model Context Protocol) service that exposes dashboards, charts,
datasets and SQL execution as tools for AI agents. Phase 19 defines **how NEXUSTHEME will use
it**; enabling it in production is a Phase 20+ task gated on the controls below.

```text
AI workflow (packages/ai-core, server-side)
        │  tool call, tenant + user from the authenticated execution
        ▼
Superset MCP service  ──►  Superset RBAC + Row Level Security  ──►  analytics.* via superset_ro
```

The agent never talks to PostgreSQL directly and never receives database credentials.

## 1. Authentication

- The MCP service is reachable only from the API network (no public ingress).
- Each call is made with a **per-tenant service principal** (a Superset user such as
  `ai-client-<slug>`), not an admin account. Credentials live in the API secret store and are
  never sent to browsers or to the model.
- Tokens are short-lived (≤ 1 h) and rotated; they are redacted from AI execution logs
  (`redactSecretsDeep`).

## 2. Authorization (RBAC)

| Superset role | Granted to | Permissions |
|---|---|---|
| `ai_reader_<client>` | AI service principal of one client | `can_read` on that client's dashboards, charts and datasets |
| `client_<client>` | Human users of one client | Same, for dashboards only |
| `analyst_staff` | Platform analysts | Dashboards + SQL Lab (read-only role) |
| `Admin` | Superset administrators | Never used by AI |

## 3. Row Level Security and tenant isolation

- Every role except staff has an RLS clause `client_id = '<tenant uuid>'` on all
  `analytics.*` tables (see `infra/superset/README.md`).
- RLS is enforced by Superset for charts, dashboards, SQL Lab **and MCP tool calls**, so an
  agent working for client A cannot read client B even if a prompt asks it to.
- The NEXUSTHEME API passes the tenant from the authenticated execution; the model cannot
  choose or change it.

## 4. Read vs write

**Default AI permission is READ-ONLY.**

| Operation | Allowed for AI |
|---|---|
| List / get dashboards, charts, datasets | ✅ (READ) |
| Get chart data / dataset sample with RLS | ✅ (READ) |
| Generate an explore link | ✅ (READ) |
| Create or update a chart or dashboard | ⚠️ Phase 20+, `WRITE_LOW_RISK`, only in the tenant's sandbox folder |
| Delete charts, dashboards or datasets | ❌ never |
| Change databases, connections, roles, RLS | ❌ never |
| `execute_sql` / SQL Lab | ❌ **not granted by default** (see §5) |

## 5. SQL Lab and `execute_sql`

- AI principals do **not** have SQL Lab access and the `execute_sql` tool is not registered in
  `packages/ai-core` (there is no arbitrary-SQL tool anywhere in the platform).
- If a future use case needs it, it must be: an explicit per-tenant opt-in, executed through
  `superset_ro` (read-only transaction, 30 s timeout), RLS-filtered, row-limited, logged as a
  `WRITE_HIGH_RISK`-class approval-gated tool in Phase 20+, with the generated SQL stored in the
  execution audit.

## 6. Allowed agent operations (initial allow-list)

`list_dashboards`, `get_dashboard_info`, `list_charts`, `get_chart_info`, `get_chart_data`,
`list_datasets`, `get_dataset_info`, `generate_explore_link`.

## 7. Prohibited operations

Anything that mutates Superset security (users, roles, RLS, database connections), any delete,
`execute_sql` (unless §5 is implemented), access to the platform `public` schema, and any call
made with a tenant other than the authenticated execution's tenant.

## 8. Audit

Every MCP call is recorded as an `ai_execution_steps` row (tool name, risk, redacted input and
output summaries, duration, status). Data returned from Superset is treated as **untrusted
input** (`wrapUntrusted`) when shown to a model.

## 9. Rollout checklist (Phase 20)

1. Deploy MCP service on the internal network only.
2. Create per-client RLS rules and `ai_reader_<client>` principals.
3. Register the allow-listed tools in `ai-core` as `READ` tools with tenant-bound credentials.
4. Acceptance gates: cross-tenant MCP call denied, `execute_sql` unavailable, secrets redacted.
