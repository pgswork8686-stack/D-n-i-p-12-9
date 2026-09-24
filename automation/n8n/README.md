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

## Directory Structure
- `workflows/`: Committed n8n workflow JSON files.
  - `cms-ai-draft.json`: CMS AI draft generation with OpenAI and HMAC callback.
  - `order-paid-email.json`: Order payment confirmation email delivery.
  - `license-provisioned-email.json`: Masked license delivery notification.
- `scripts/`: Validation scripts.
  - `validate-workflows.mjs`: Automated CI linter for security and architecture compliance.
- `examples/`: Reference configuration.
  - `env.example`: Environment variables required for n8n execution.

## Workflow Validation
To validate all workflows locally:
```bash
node automation/n8n/scripts/validate-workflows.mjs
```
