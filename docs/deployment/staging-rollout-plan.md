# PGS staging rollout — environment isolation and acceptance

This is a **staging-only** procedure on a dedicated VPS. It does not deploy by itself. Start from the reviewed `main` SHA and keep **production FEATURE_SERVICES=false**. Never copy production secrets, live DB backups, real customer data, or active payment credentials into staging.

## Architecture (existing)

- Ubuntu VPS + Docker Compose: Caddy (only public 80/443), API/NestJS, Worker/BullMQ, Next.js Web/Portal/Admin, **local private PostgreSQL**, private Redis.
- Separate Supabase **Auth** project (the app's SQL DB is still Docker PostgreSQL, not Supabase PostgreSQL).
- Separate **private R2 staging bucket**, credentials limited to that bucket. n8n is an external optional orchestration service.
- Cloudflare initially **DNS only** for all staging records → Caddy → API, so **TRUST_PROXY_HOPS=1**. Never expose API port 4000, Postgres 5432 or Redis 6379.
- Docker Compose uses `APP_ENV_FILE` for API/Worker/Migrate secrets. `--env-file` alone affects interpolation and **does not change** the application `env_file` unless `APP_ENV_FILE` is set.

## Inputs the operator must provision (never in GitHub comments)

1. A **dedicated staging VPS** (SSH via protected access), its public IP and four real staging hostnames: Web, Portal, Admin, API; operator ACME email.
2. Staging-only Supabase Auth URL / anon / service-role keys; staging-only **private** R2 bucket / S3 endpoint / restricted API token.
3. Strong, independent Postgres/Redis passwords, LICENSE_KEY_ENCRYPTION_KEY, AUTOMATION_SERVICE_SECRET, SERVICE_INQUIRY_IP_SALT; approved SePay staging/test account and webhook credential because production-grade preflight requires payment config even if not testing checkout.
4. A public **approved HTTPS privacy-policy URL** and consent version before enabling the staging form; staging staff login account with `inquiry.read`.
5. Optional separately configured n8n staging instance and Resend/test inbox for notifications. Do not use real customer recipient email addresses.

## Initial bootstrap: Services disabled

On the dedicated staging host, from repository root, **after reviewing this PR and merging it**:

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
# Edit .env.staging locally: real staging hostnames/secrets, keep all unsafe
# flags false and FEATURE_SERVICES=false. Never paste contents into chat.
bash infra/scripts/staging-preflight.sh
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging config --quiet
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging up -d --build
bash infra/scripts/staging-smoke.sh \
  YOUR_WEB_STAGING_HOST YOUR_PORTAL_STAGING_HOST YOUR_ADMIN_STAGING_HOST YOUR_API_STAGING_HOST
```

Use a dedicated host so production ports, storage volumes and Caddy never overlap. The Compose project is **nexustheme-staging**. If preflight fails, **STOP**: never remove a gate to make a deployment work.

## Before enabling the form on staging

- Verify all four hostnames resolve to the correct staging VPS and Caddy serves valid HTTPS. Confirm Supabase Auth login, private R2 upload and expiring signed download, DB/Redis readiness and backup + restore to a disposable database.
- Verify the real client IP via `docs/deployment/proxy-topology.md`: inject fake `X-Forwarded-For` and confirm API logs the true client address. Staging mode here supports **DNS only**, Caddy as one proxy. If using Cloudflare orange cloud, STOP; configure its trusted CIDRs and review topology first.
- Confirm Caddy HTTP 413 limits (5/13/53/60 MiB), authentication/IDOR, consent policy text, rate limiting and rollback.
- Do not run paid SePay transactions, send email to customers or import real production data without independent approval.

## Services staging pilot — explicit second gate

After publishing the reviewed staging HTTPS privacy policy and preparing an ACTIVE `custom-web-app-development` service using staging Admin (seed defaults to DRAFT):

1. Confirm the latest Worker and API image versions. For updates, **migrate → Worker → API → Web/Admin/Portal**. The Worker must understand `SERVICE_INQUIRY_CREATED` before the API can emit it. `worker` normally depends on API being healthy; use `--no-deps` for an existing stack update when deploying it **before** API.
2. Change **only staging** `.env.staging`: `FEATURE_SERVICES=true`, `SERVICE_CONSENT_VERSION` to the reviewed version, `PRIVACY_POLICY_URL` to the actual HTTPS policy, `SERVICE_INQUIRY_IP_SALT` to 32+ random characters. Leave `SERVICE_INQUIRY_NOTIFY_EMAILS` empty until n8n is tested.
3. Run `ALLOW_STAGING_SERVICES=true bash infra/scripts/staging-preflight.sh` and stop on any error. Keep an approved maintenance/rollback window. Then deploy in order:

```bash
# For an EXISTING healthy staging stack after database backup:
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging up --build migrate
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging up -d --no-deps --build worker
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging up -d --no-deps --build api
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging up -d --no-deps --build web portal admin
```

**Important:** The deployment commands are NOT executed by this PR. If the old API already emits an event type that the old Worker does not recognize, stop and plan recovery; don't race the order. Check API and Worker logs before opening the form.

## Staging UAT evidence required

- `GET /v1/features`, active Services catalog, HTTPS `GET /v1/service-inquiries/consent`; new form only when consent and active service exist, CTA otherwise.
- Browser Playwright at **1440 / 768 / 390** in both CTA and form configurations, including axe and the required-field errors. Valid form returns **HTTP 201 + SI reference**, processing consent unticked by default and optional marketing unticked.
- DB proves `consent_version`, server timestamp, `marketing_consent=false` when unticked, exactly one inquiry per submissionKey. Outbox PENDING → PROCESSED, staff only with `inquiry.read` notified, exactly one audit `SERVICE_INQUIRY_NOTIFIED`.
- Import `automation/n8n/workflows/service-inquiry-notify-email.json` into **staging n8n** separately; test credential scopes, HMAC, rejected replays and email escape + delivery to an approved test inbox. The repository's `n8n:smoke` currently exercises other workflows, **not this new service-inquiry workflow**; do not claim it has passed without testing.
- Signed private R2 downloads, Supabase login, Cloudflare/Caddy topology, API 413, backup/restore, certificate renewal, monitored logs and resource usage.

## Blockers / exit criteria

Until all staging tests above are recorded and the owner explicitly approves production rollout, **production FEATURE_SERVICES stays false**. Merge of the staging-preparation PR alone never starts a VPS deployment. Do not mark this as production-ready without real infrastructure access and UAT evidence.

For database backup on staging, the existing scripts default to `.env.production` and MUST be invoked with **`COMPOSE_ENV_FILE="$PWD/.env.staging"`** and an isolated backup directory. Never run their restore script without confirming the database target and a recoverable backup.
