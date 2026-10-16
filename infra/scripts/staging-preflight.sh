#!/usr/bin/env bash
# Staging environment isolation gate. Checks only; never deploys or prints secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"
ENV_FILE="${1:-.env.staging}"
[[ "$#" -le 1 ]] || { echo "[FAIL] Usage: bash infra/scripts/staging-preflight.sh [.env.staging]" >&2; exit 1; }
command -v realpath >/dev/null || { echo "[FAIL] realpath required" >&2; exit 1; }
[[ "$(realpath -m "$ENV_FILE")" == "$ROOT/.env.staging" ]] || {
  echo "[FAIL] Only .env.staging is accepted; production env files are forbidden" >&2; exit 1;
}
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || {
  echo "[FAIL] .env.staging must exist and must not be a symlink" >&2; exit 1;
}
declare -A cfg=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
  [[ "$line" == *=* ]] || { echo "[FAIL] Malformed staging environment line" >&2; exit 1; }
  key="${line%%=*}"
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "[FAIL] Invalid staging variable name" >&2; exit 1; }
  cfg["$key"]="${line#*=}"
done < "$ENV_FILE"

require_eq() {
  local key="$1" expected="$2"
  [[ "${cfg[$key]:-}" == "$expected" ]] || {
    echo "[FAIL] $key is not set to the staging-safe value" >&2; exit 1;
  }
}
require_eq COMPOSE_PROJECT_NAME nexustheme-staging
require_eq APP_ENV_FILE ../../.env.staging
require_eq NODE_ENV production
require_eq TRUST_PROXY_HOPS 1

# Shell vars override Compose --env-file. Refuse an accidental production override.
for key in APP_ENV_FILE COMPOSE_PROJECT_NAME; do
  if [[ -v "$key" && "${!key}" != "${cfg[$key]}" ]]; then
    echo "[FAIL] Exported $key conflicts with .env.staging" >&2; exit 1;
  fi
done

for key in WEB_DOMAIN PORTAL_DOMAIN ADMIN_DOMAIN API_DOMAIN; do
  domain="${cfg[$key]:-}"
  [[ "${domain,,}" == *staging* ]] || {
    echo "[FAIL] $key must contain staging to avoid production hostnames" >&2; exit 1;
  }
  [[ "$domain" != *.example.com && "$domain" != *.example.invalid && "$domain" != *.test ]] || {
    echo "[FAIL] $key still contains a reserved example hostname" >&2; exit 1;
  }
done
for key in POSTGRES_USER POSTGRES_DB STORAGE_BUCKET; do
  [[ "${cfg[$key]:-}" == *staging* ]] || {
    echo "[FAIL] $key must identify an isolated staging resource" >&2; exit 1;
  }
done

[[ "${cfg[FEATURE_SERVICES]:-false}" == false || "${cfg[FEATURE_SERVICES]:-false}" == true ]] || {
  echo "[FAIL] FEATURE_SERVICES must be true or false" >&2; exit 1;
}
if [[ "${cfg[FEATURE_SERVICES]:-false}" == true ]]; then
  [[ "${ALLOW_STAGING_SERVICES:-false}" == true ]] || {
    echo "[FAIL] Enable Services only with ALLOW_STAGING_SERVICES=true on staging" >&2; exit 1;
  }
  salt="${cfg[SERVICE_INQUIRY_IP_SALT]:-}"
  [[ "${#salt}" -ge 32 ]] || {
    echo "[FAIL] SERVICE_INQUIRY_IP_SALT must have at least 32 characters" >&2; exit 1;
  }
  [[ "${cfg[SERVICE_CONSENT_VERSION]:-}" =~ ^[a-zA-Z0-9._-]{1,64}$ ]] || {
    echo "[FAIL] SERVICE_CONSENT_VERSION is invalid" >&2; exit 1;
  }
  policy="${cfg[PRIVACY_POLICY_URL]:-}"
  [[ "$policy" == https://* && "$policy" != *example.* && "$policy" != *localhost* ]] || {
    echo "[FAIL] PRIVACY_POLICY_URL must be a real, reviewed HTTPS policy" >&2; exit 1;
  }
fi

bash "$ROOT/infra/scripts/production-preflight.sh" "$ROOT/.env.staging"
echo "[PASS] Staging config isolation + production-grade preflight passed. NO deployment executed."
