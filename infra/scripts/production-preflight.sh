#!/usr/bin/env bash
# Validate production config before spending time building six Docker targets.
# Does not print secret values or execute the .env file.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/infra/docker/production-compose.yml"
[[ -f "$ENV_FILE" ]] || { echo "[FAIL] Missing environment file: $ENV_FILE" >&2; exit 1; }
declare -A config=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*# || "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" == *=* ]] || { echo "[FAIL] Invalid .env line (expected KEY=value)" >&2; exit 1; }
  key="${line%%=*}"
  value="${line#*=}"
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "[FAIL] Invalid variable name: $key" >&2; exit 1; }
  config["$key"]="$value"
done < "$ENV_FILE"
fails=0
required=(NODE_ENV WEB_DOMAIN PORTAL_DOMAIN ADMIN_DOMAIN API_DOMAIN ACME_EMAIL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB REDIS_PASSWORD SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY LICENSE_KEY_ENCRYPTION_KEY AUTOMATION_SERVICE_SECRET STORAGE_PROVIDER STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_ACCESS_KEY STORAGE_SECRET_KEY SEPAY_BANK_CODE SEPAY_BANK_ACCOUNT SEPAY_ACCOUNT_NAME SEPAY_WEBHOOK_API_KEY PAYMENT_RETURN_BASE_URL)
for key in "${required[@]}"; do
  val="${config[$key]:-}"
  if [[ -z "${val//[[:space:]]/}" || "$val" == *'<'* || "$val" == *'>'* || "$val" == "CHANGE_ME" ]]; then
    echo "[FAIL] $key is missing or contains a placeholder"; ((fails+=1))
  fi
done
[[ "${config[NODE_ENV]:-}" == "production" ]] || { echo "[FAIL] NODE_ENV must be production"; ((fails+=1)); }
[[ "${config[STORAGE_PROVIDER]:-}" == "s3" ]] || { echo "[FAIL] STORAGE_PROVIDER must be s3 for R2"; ((fails+=1)); }
[[ "${config[SUPABASE_URL]:-}" == https://* ]] || { echo "[FAIL] SUPABASE_URL must be https"; ((fails+=1)); }
[[ "${config[STORAGE_ENDPOINT]:-}" == https://* ]] || { echo "[FAIL] STORAGE_ENDPOINT must be https"; ((fails+=1)); }
[[ "${config[LICENSE_KEY_ENCRYPTION_KEY]:-}" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "[FAIL] LICENSE_KEY_ENCRYPTION_KEY must have 64 hex characters"; ((fails+=1)); }
for key in POSTGRES_PASSWORD REDIS_PASSWORD AUTOMATION_SERVICE_SECRET; do
  [[ "${#config[$key]}" -ge 16 ]] || { echo "[FAIL] $key is too short"; ((fails+=1)); }
done
[[ "${#config[AUTOMATION_SERVICE_SECRET]}" -ge 32 ]] || { echo "[FAIL] AUTOMATION_SERVICE_SECRET must have 32+ characters"; ((fails+=1)); }
[[ "${#config[SEPAY_WEBHOOK_API_KEY]}" -ge 24 ]] || { echo "[FAIL] SEPAY_WEBHOOK_API_KEY must have 24+ characters"; ((fails+=1)); }
for key in WEB_DOMAIN PORTAL_DOMAIN ADMIN_DOMAIN API_DOMAIN; do
  [[ "${config[$key]:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ ]] || { echo "[FAIL] Invalid hostname: $key"; ((fails+=1)); }
done
declare -A domains=()
for key in WEB_DOMAIN PORTAL_DOMAIN ADMIN_DOMAIN API_DOMAIN; do
  domain="${config[$key]:-}"
  if [[ -n "${domains[$domain]:-}" ]]; then
    echo "[FAIL] $key duplicates ${domains[$domain]}"; ((fails+=1))
  fi
  domains[$domain]="$key"
done
[[ "${config[PAYMENT_RETURN_BASE_URL]:-}" == "https://${config[WEB_DOMAIN]:-}" ]] || { echo "[FAIL] PAYMENT_RETURN_BASE_URL must match WEB_DOMAIN"; ((fails+=1)); }
for key in FEATURE_HOSTING FEATURE_MEMBERSHIP FEATURE_AFFILIATE FEATURE_FINANCE ENABLE_TEST_PAYMENT_PROVIDER STRIPE_MOCK_CLIENT SEED_DEV_USERS NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS; do
  [[ "${config[$key]:-false}" == "false" ]] || { echo "[FAIL] Unsafe staging flag: $key must be false"; ((fails+=1)); }
done
if (( fails > 0 )); then
  echo "[FAIL] $fails configuration checks failed. No deployment performed." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "[FAIL] Docker CLI not found" >&2; exit 1; }
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet || { echo "[FAIL] Docker Compose config is invalid" >&2; exit 1; }
echo "[PASS] Production configuration checks passed. This does NOT prove external integrations."
