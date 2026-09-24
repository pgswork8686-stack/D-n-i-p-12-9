# NEXUSTHEME PRODUCTION CUTOVER & GO-LIVE RUNBOOK

**Target SLA**:
- **RPO (Recovery Point Objective)**: < 15 minutes
- **RTO (Recovery Time Objective)**: < 30 minutes
- **Downtime Window**: Planned Blue/Green Cutover (< 60 seconds traffic swap)

---

## 1. Cutover Architecture & Domain Routing

| Subdomain | Target Application | Port | Technology Stack |
| :--- | :--- | :--- | :--- |
| `nexustheme.com` / `www` | Storefront & Catalog | 3000 | Next.js 14 App Router |
| `app.nexustheme.com` | Customer Portal & Downloads | 3001 | Next.js 14 App Router |
| `admin.nexustheme.com` | Super Admin & Backoffice | 3002 | Next.js 14 App Router |
| `api.nexustheme.com` | Core Monolith API | 4000 | NestJS Fastify/Express |
| *(Internal)* | BullMQ Asynchronous Worker | N/A | Node.js Worker Process |

---

## 2. Cutover Execution Phases

### Phase 1: Pre-Cutover Preparation (T-24h to T-2h)
1. **Container Image Integrity**:
   - Verify all 5 production Docker images are built and pushed to GitHub Container Registry (`ghcr.io`).
   - Run vulnerability scans on base images (`alpine`, `node:20-alpine`).
2. **Production Environment Audit**:
   - Confirm production secrets are populated in Coolify/Docker environment variables:
     - `POSTGRES_PASSWORD`, `DATABASE_URL` (SSL mode enabled).
     - `REDIS_PASSWORD`, `REDIS_URL`.
     - `STRIPE_SECRET_KEY` (livemode: `sk_live_...`), `STRIPE_WEBHOOK_SECRET` (`whsec_...`).
     - `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (Cloudflare R2 production keys).
     - `LICENSE_KEY_ENCRYPTION_KEY` (64-character hex key).
     - `HOSTING_ENCRYPTION_KEY` (64-character hex key).
     - `SEED_DEV_USERS` must be explicitly `false`.
3. **Pre-flight Backup Drill**:
   - Run `./infra/scripts/backup-db.sh ./pre-cutover-backups`.
   - Validate checksum with `./infra/scripts/verify-backup.sh`.

---

### Phase 2: Maintenance Window & Queue Draining (T-30m to T-15m)
1. **Cloudflare Maintenance Rule Activation**:
   - Enable Cloudflare Page Rule for `/checkout` and `/api/v1/orders/checkout` returning HTTP 503 Maintenance Notice.
2. **Worker Queue Draining**:
   - Signal worker process to stop accepting new jobs: `pnpm worker:drain`.
   - Wait for active jobs (`ORDER_PAID`, `PROVISION_HOSTING_ACCOUNT`, `INVOICE_GENERATION`) to reach 0.
3. **Point-in-Time Database Snapshot**:
   - Execute final pre-migration database snapshot:
     ```bash
     ./infra/scripts/backup-db.sh /var/backups/cutover-final-snapshot
     ```

---

### Phase 3: Additive Database Migrations & RBAC Seeding (T-15m to T-5m)
1. **Execute Zero-Downtime Prisma Migrations**:
   ```bash
   pnpm db:migrate
   ```
   *Invariant: All migrations from Phase 1 through Phase 17 are strictly additive (no destructive column drops).*
2. **Seed System RBAC & System Settings**:
   ```bash
   NODE_ENV=production SEED_DEV_USERS=false pnpm db:seed:all
   ```
   *Verifies all system roles (`SUPER_ADMIN`, `SUPPORT_AGENT`, `FINANCE_OFFICER`) and permissions are synchronized.*

---

### Phase 4: Production Container Spin-up & Deep Healthchecks (T-5m to T-0)
1. **Spin up Production Services via Coolify**:
   ```bash
   docker compose -f infra/docker/production-compose.yml up -d
   ```
2. **Probe Deep Readiness Endpoints**:
   ```bash
   curl -f http://localhost:4000/health/liveness
   curl -f http://localhost:4000/health/readiness
   ```
   *Must return HTTP 200 with `database: ok`, `redis: ok`, `storage: ok`.*
3. **Verify Security Headers**:
   ```bash
   curl -I http://localhost:4000/health/liveness
   ```
   *Must contain `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`.*

---

### Phase 5: DNS Switch & Post-Cutover Verification (T+0 to T+30m)
1. **Cloudflare DNS Cutover**:
   - Point `nexustheme.com`, `app`, `admin`, `api` DNS records to production ingress VIP.
   - Set SSL/TLS encryption mode to **Strict (Full)**.
   - Enable Cloudflare Managed WAF & Bot Fight Mode.
2. **End-to-End Live Smoke Test**:
   - Browse catalog at `https://nexustheme.com/products`.
   - Perform test purchase using live corporate testing card.
   - Verify instant entitlement generation, license key assignment, and commercial PDF invoice issuance.
   - Verify outbox event propagation to worker.
3. **Disable Maintenance Window**:
   - Remove Cloudflare maintenance page rule.

---

## 3. Rollback Decision Matrix

| Condition | Threshold | Rollback Action |
| :--- | :--- | :--- |
| Database Migration Failure | Migration error / lock timeout | Abort cutover, restore from pre-cutover snapshot |
| API Readiness Probe Down | > 3 consecutive failures (30s) | Rollback container image to previous tag |
| Live Checkout Failure | HTTP 500 on checkout | Re-enable Cloudflare maintenance, investigate worker |
| Latency Spike | p99 > 3000ms for > 5 minutes | Scale worker & API container instances |

### Automated Cold Restore Execution (If required):
```bash
./infra/scripts/restore-db.sh /var/backups/cutover-final-snapshot/nexustheme_marketplace_*.sql.gz --force
```
