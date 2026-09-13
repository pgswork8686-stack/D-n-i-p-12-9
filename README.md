# NEXUSTHEME — Digital Product Commerce Platform

NEXUSTHEME is a digital product commerce platform for themes, plugins, UI kits, software licenses, external managed licenses, memberships/subscriptions, and service fulfillment.

## Repository status
- `main`: Foundation + Identity/RBAC + Catalog/Admin are merged.
- Current implementation phase: **Phase 4 — Commerce Core**.
- Active Phase 4 PR: **#6** (`feature/phase-4-commerce-core`).
- Do not infer current scope from old PR descriptions; use the governance docs below.

## Mandatory project docs
Before implementing anything, read in this order:
1. [`AGENTS.md`](./AGENTS.md) — rules for implementation agents
2. [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — architecture/domain constitution
3. [`ROADMAP.md`](./ROADMAP.md) — ordered product/implementation roadmap
4. [`CURRENT_PHASE.md`](./CURRENT_PHASE.md) — exactly what may be implemented now
5. [`docs/README.md`](./docs/README.md) and the matching phase spec
6. [`DECISIONS.md`](./DECISIONS.md) — durable architecture/business decisions

Implementation agents must not merge their own phase PRs. Phase changes require independent review and explicit PASS.

## Architecture

```text
Cloudflare
  ├─ www.domain.com   -> Next.js Marketplace/SEO
  ├─ app.domain.com   -> Next.js Customer Portal
  └─ admin.domain.com -> Next.js Admin/CMS
               |
          api.domain.com
              NestJS
               |
   PostgreSQL + Redis/BullMQ + private object storage
               |
        Worker + n8n + External APIs
```

Core rules:
- PostgreSQL is the source of truth for business state.
- NestJS backend owns business-critical transitions.
- Entitlement is the authorization core: `Order -> OrderItem -> Entitlement -> Fulfillment`.
- Frontends/n8n do not directly mutate order/payment/entitlement/license/allocation state.
- V1 stays a modular monolith.
- Private product packages are never permanent public URLs.

## Local ports

| Service | Local URL | Purpose |
|---|---|---|
| Public Web | `http://localhost:3000` | Marketplace/catalog/SEO |
| Customer Portal | `http://localhost:3001` | Customer account/orders/access |
| Admin | `http://localhost:3002` | Product/admin/operations |
| API | `http://localhost:4000` | NestJS business core |
| PostgreSQL | `localhost:5432` | Source-of-truth DB |
| Redis | `localhost:6379` | Queue/cache/coordination |
| MinIO S3 API | `http://localhost:9000` | Local R2-compatible storage |
| MinIO Console | `http://localhost:9001` | Local storage admin |

## Local quickstart

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed:system
```

For local development data only:

```bash
SEED_DEV_USERS=true pnpm db:seed:dev
pnpm db:seed:catalog
```

Or use the guarded local convenience seed when appropriate:

```bash
pnpm db:seed:local
```

Start the workspace:

```bash
pnpm dev
```

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build --concurrency=2
pnpm worker:smoke
```

Business-critical phases also require their phase-specific live acceptance suite against real local PostgreSQL/Redis. See `docs/phases/`.

## Health endpoints
- `GET http://localhost:4000/health`
- `GET http://localhost:4000/health/db`
- `GET http://localhost:4000/health/redis`
- `GET http://localhost:4000/health/storage`

Health checks must reflect real dependency state and fail closed/503 when required dependencies are unavailable.

## Product direction
The next product milestone is not “finish every platform subsystem.” It is to prove a real lifecycle:

```text
browse
-> cart
-> checkout
-> payment
-> order paid
-> entitlement
-> fulfillment
-> customer can access again later
```

See `ROADMAP.md` for the ordered implementation sequence and `docs/business/project-input-checklist.md` for owner/business inputs that agents must not invent.
