# External Integration Gap Analysis

**Date:** 2026-10-07  
**Current System State:** `LOCAL FULLY PROVEN (READY FOR EXTERNAL INTEGRATION)`  
**Target Next State:** `STAGING PROVEN`  

---

## 1. Local vs External Capability Comparison

| Capability | Local Environment State | External Staging Requirements | Gap / Action Required |
|:---|:---|:---|:---|
| **Database** | PostgreSQL 16 (`marketplace_ci`) migrated & seeded | Supabase PostgreSQL with PgBouncer connection pooling | Run `prisma migrate deploy` against Supabase connection string. |
| **Authentication** | Local JWT & Dev auth bypass (`dev-customer-token`) | Supabase Auth (GoTrue) with real email confirmation | Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| **Object Storage** | MinIO S3-compatible service (`marketplace-dev`) | Cloudflare R2 bucket with custom domain or worker proxy | Configure R2 credentials, bucket name, and endpoint. |
| **Payment Gateway** | Internal test callback provider & mock client | SePay sandbox / production webhook receiver | Configure SePay API key, bank account, and webhook secret. |
| **Networking & TLS** | Loopback HTTP (`localhost:3000..4000`) | Real HTTPS domain names behind Cloudflare Full (Strict) SSL | Configure DNS A/CNAME records for API, web, portal, and admin. |
| **Background Worker** | Local Node.js process / isolated container | Daemon process on VPS running `nexustheme-worker` | Ensure environment variables for DB and Redis are identical to API. |

---

## 2. Required Non-Secret Configuration Inputs

Before staging deployment, only the following non-secret parameters are required:

1. **Staging VPS Host**:
   - Staging IP address / hostname
   - Deployment orchestrator: Docker Compose or Coolify
2. **Domain Names (FQDNs)**:
   - Storefront Web: `https://staging.domain.vn` (or subfolder/subdomain)
   - Customer Portal: `https://portal-staging.domain.vn`
   - Admin Console: `https://admin-staging.domain.vn`
   - Core API: `https://api-staging.domain.vn`
3. **Cloudflare R2**:
   - Bucket name: e.g. `nexustheme-staging-artifacts`
   - S3 endpoint URL: `https://<account-id>.r2.cloudflarestorage.com`
4. **SePay**:
   - Bank code: e.g. `MBBank`
   - Account number (public receiver)
5. **Supabase**:
   - Project URL: `https://<project-ref>.supabase.co`

---

## 3. Strict Secret Handling Protocol

> [!IMPORTANT]
> **NO SECRETS MUST BE ENTERED INTO CHAT OR COMMITTED TO GIT.**
> All secret environment variables must be configured directly on the staging server / Coolify dashboard / GitHub Environment secrets:
>
> - `DATABASE_URL` (Supabase connection string with password)
> - `SUPABASE_SERVICE_ROLE_KEY`
> - `STORAGE_ACCESS_KEY` & `STORAGE_SECRET_KEY` (Cloudflare R2 tokens)
> - `SEPAY_API_KEY` & `SEPAY_WEBHOOK_SECRET`
> - `LICENSE_KEY_ENCRYPTION_KEY` (64-character hex string)
> - `HOSTING_ENCRYPTION_KEY` (64-character hex string)
> - `AUTOMATION_SERVICE_SECRET`

---

## 4. Transition Criteria to `STAGING PROVEN`

To transition from `LOCAL FULLY PROVEN` to `STAGING PROVEN`, the following real-world sequence must be executed on staging infrastructure:

```text
1. Successful deployment to Staging VPS
2. HTTPS 200 OK on Storefront, Customer Portal, Admin Console, and API /health
3. User signs up via real Supabase Auth
4. User completes checkout using real SePay payment flow
5. SePay webhook received and verified with valid signature
6. Order status transitions to PAID
7. Entitlement created with ACTIVE status
8. Internal license provisioned with AES-256-GCM encryption
9. Customer successfully requests and downloads signed artifact package from Cloudflare R2
10. System audit logs captured with real transaction references
```

Until all 10 steps above have been proven with real external infrastructure, the status remains:
**`LOCAL FULLY PROVEN (READY FOR EXTERNAL INTEGRATION)`**
