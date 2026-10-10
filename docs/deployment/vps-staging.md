# VPS staging deployment: validated first pass

This patch makes the existing **single-server Docker Compose** model the canonical staging deployment. It does **not** switch the database to Supabase PostgreSQL: the local Postgres container remains the application database, while **Supabase Auth** is an external identity provider.

## 1. Requirements

- A separate staging VPS running Ubuntu with Docker Engine and Docker Compose plugin.
- Four DNS hostnames pointing at the VPS: WEB_DOMAIN, PORTAL_DOMAIN, ADMIN_DOMAIN, API_DOMAIN.
- Supabase Auth project, **private** Cloudflare R2 bucket, SePay staging/test credentials, and email for ACME HTTPS.
- Do not commit secrets or paste them in tickets or chat. Configure a root-owned .env.production file with permission 600.

## 2. Deploy from a reviewed commit

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Complete the environment file with legitimate credentials.
bash infra/scripts/production-preflight.sh
# Read the output and fix any failures; then run:
docker compose --env-file .env.production -f infra/docker/production-compose.yml up -d --build
bash infra/scripts/staging-smoke.sh <WEB_DOMAIN> <PORTAL_DOMAIN> <ADMIN_DOMAIN> <API_DOMAIN>
```

The preflight checks configuration syntax and safety only. Smoke checks HTTPS pages, public products and API readiness. Neither proves payments, authorization, signed downloads, mail or DNS-provider operations; perform the [go-live checklist](../runbooks/go-live-checklist.md) against staging.

## 3. Back up before changes

The production database port is deliberately **not exposed** on the VPS host. Backups and restores therefore use `docker compose exec -T postgres`, not `pg_dump -h localhost`.

```bash
# Run from repository root, with .env.production completed.
bash infra/scripts/backup-db.sh
bash infra/scripts/verify-backup.sh backups/<filename>.sql.gz
# Before restoring, stop API and worker and schedule a maintenance window.
docker compose --env-file .env.production -f infra/docker/production-compose.yml stop api worker
bash infra/scripts/restore-db.sh backups/<filename>.sql.gz
# Then restart the stack and recheck readiness.
docker compose --env-file .env.production -f infra/docker/production-compose.yml up -d api worker
```

For an **external** Postgres server, set `DB_ACCESS_MODE=direct` and provide `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` and Postgres client tools. Do not expose database ports publicly just to run backup.

Backups are saved locally by default. Set `BACKUP_R2_BUCKET`, `STORAGE_ENDPOINT` and appropriately scoped AWS CLI credentials for offsite replication, and test a restore in an isolated staging database before launch. A backup without a tested restore does not constitute disaster recovery.

## 4. Required end-to-end acceptance

Verify actual Supabase login and RBAC; SePay webhook signature and wrong-amount behavior; real R2 signed downloads; license issuance; Redis worker processing; backup/restore and recovery; TLS renewal; and observed CPU, memory and storage usage. **Do not activate hosting, membership, affiliate or finance features** until separate acceptance is completed.
