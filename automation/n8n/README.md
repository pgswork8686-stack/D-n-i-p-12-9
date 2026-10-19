# NEXUSTHEME — n8n Automation Engine

This directory contains the authoritative n8n workflow definitions and validation tooling for NEXUSTHEME Phase 12.

## Architecture & Boundaries

```text
NestJS Business Backend
        ↓
Outbox / AutomationJob
        ↓
BullMQ Worker
        ↓
n8n (Orchestration Only)
        ↓
AI Provider / Email Gateway
        ↓
Signed Internal Backend API (HMAC-SHA256)
        ↓
Backend Validation + PostgreSQL Transaction
```

### Strict Security Invariants
1. **Orchestration Only**: n8n has **zero direct authority** over business-critical state.
2. **Zero Database Access**: n8n must never connect directly to PostgreSQL, Prisma, or Supabase database tables. All state interactions go through signed HTTP APIs.
3. **Cryptographic Proof (HMAC-SHA256)**: All callbacks from n8n to `/v1/internal/automation/*` must supply HMAC headers (`X-Nexus-Service`, `X-Nexus-Timestamp`, `X-Nexus-Request-Id`, `X-Nexus-Signature`) signed with `AUTOMATION_SERVICE_SECRET`.
4. **Human-in-the-Loop CMS**: AI draft generation outputs create posts in `AI_DRAFT` status ONLY. Never `PUBLISHED` or `REVIEW`.
5. **No Plaintext License Secrets**: License notifications send masked keys (`NXS-****-...-9999`) and secure Portal links. Never plaintext keys.
6. **Zero Committed Secrets**: Workflow files must never contain hardcoded API keys, bearer tokens, passwords, or connection strings.
7. **Fail-Closed Replay Guard**: every dispatch workflow claims `nexus:n8n:dispatch-replay:<requestId>` with `SET NX PX 600000` in Redis before any provider call. The n8n container must be given `N8N_REPLAY_REDIS_HOST` and `N8N_REPLAY_REDIS_PORT` (and `N8N_REPLAY_REDIS_PASSWORD` when the Redis requires one) pointing at a Redis dedicated to this n8n; there is no default endpoint, so a missing value rejects every dispatch instead of writing into whatever Redis listens on :6379. `pnpm n8n:validate` runs `scripts/check-replay-guard.mjs`, which executes the generated guard against a fake Redis (replay with and without a password, refused AUTH, closed connection, silence, missing endpoint).

## Directory Structure
- `workflows/`: Committed n8n workflow JSON files.
  - `cms-ai-draft.json`: CMS AI draft generation with OpenAI and HMAC callback.
  - `order-paid-email.json`: Order payment confirmation email delivery.
  - `license-provisioned-email.json`: Masked license delivery notification.
  - `service-inquiry-notify-email.json`: Staff notification for a new service inquiry (reference, service and company name only; no contact details or requirements; all free text is HTML-escaped). Webhook `/webhook/service-inquiry-notify-email`; worker route env `N8N_SERVICE_INQUIRY_NOTIFY_EMAIL_WEBHOOK_URL`.
- `scripts/`: Validation scripts.
  - `validate-workflows.mjs`: Automated CI linter for security and architecture compliance.
- `examples/`: Reference configuration.
  - `env.example`: Environment variables required for n8n execution.

## Workflow Validation
To validate all workflows locally:
```bash
node automation/n8n/scripts/validate-workflows.mjs
```
