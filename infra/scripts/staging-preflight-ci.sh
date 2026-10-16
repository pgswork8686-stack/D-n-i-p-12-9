#!/usr/bin/env bash
# Harmless CI-only positive/negative tests of staging isolation. Never deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"
[[ ! -e .env.staging ]] || { echo "Refusing to overwrite an existing .env.staging" >&2; exit 1; }
trap 'rm -f .env.staging' EXIT
cp .env.staging.example .env.staging
python3 - <<'PY'
from pathlib import Path
p = Path(".env.staging")
mapping = {
  "WEB_DOMAIN": "web-staging.ci.example.org",
  "PORTAL_DOMAIN": "app-staging.ci.example.org",
  "ADMIN_DOMAIN": "admin-staging.ci.example.org",
  "API_DOMAIN": "api-staging.ci.example.org",
  "ACME_EMAIL": "ops@ci.example.org",
  "POSTGRES_PASSWORD": "fake-staging-ci-postgres-password-32",
  "REDIS_PASSWORD": "fake-staging-ci-redis-password-32",
  "SUPABASE_URL": "https://staging-auth.ci.example.org",
  "SUPABASE_ANON_KEY": "fake-staging-ci-anon-key",
  "SUPABASE_SERVICE_ROLE_KEY": "fake-staging-ci-service-role-key",
  "LICENSE_KEY_ENCRYPTION_KEY": "a" * 64,
  "AUTOMATION_SERVICE_SECRET": "fake-staging-ci-automation-secret-12345",
  "STORAGE_ENDPOINT": "https://staging-r2.ci.example.org",
  "STORAGE_ACCESS_KEY": "fake-staging-ci-storage-access-key",
  "STORAGE_SECRET_KEY": "fake-staging-ci-storage-secret-key",
  "SEPAY_BANK_CODE": "TEST",
  "SEPAY_BANK_ACCOUNT": "000000000000",
  "SEPAY_ACCOUNT_NAME": "STAGING ONLY FAKE",
  "SEPAY_WEBHOOK_API_KEY": "fake-staging-ci-sepay-webhook-key-long",
  "PAYMENT_RETURN_BASE_URL": "https://web-staging.ci.example.org",
}
lines = p.read_text().splitlines()
seen = set()
out = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        k, _ = line.split("=", 1)
        if k in mapping:
            line = f"{k}={mapping[k]}"
            seen.add(k)
    out.append(line)
assert seen == set(mapping), sorted(set(mapping) - seen)
p.write_text("\n".join(out) + "\n")
PY

# Positive: non-secret dummy config is accepted without deploying anything.
bash infra/scripts/staging-preflight.sh
docker compose --env-file .env.staging -f infra/docker/production-compose.yml \
  -p nexustheme-staging config --format json > staging-ci-rendered.json
python3 - <<'PY'
import json
from pathlib import Path
x = json.loads(Path("staging-ci-rendered.json").read_text())
assert x["name"] == "nexustheme-staging", x.get("name")
for service in ("api", "worker", "migrate"):
    env = x["services"][service]["environment"]
    assert env["SUPABASE_SERVICE_ROLE_KEY"] == "fake-staging-ci-service-role-key", service
    assert env["STORAGE_BUCKET"] == "pgs-staging-private", service
    assert env["NODE_ENV"] == "production", service
print("[PASS] API, worker, and migrate use staging-only runtime credentials.")
PY
rm -f staging-ci-rendered.json

# Negative: refuse a path back to .env.production even though Compose itself
# supports legacy production defaults.
sed -i 's|^APP_ENV_FILE=.*|APP_ENV_FILE=../../.env.production|' .env.staging
if bash infra/scripts/staging-preflight.sh >/dev/null 2>&1; then
  echo "[FAIL] Staging preflight accepted a production env-file path" >&2; exit 1
fi
sed -i 's|^APP_ENV_FILE=.*|APP_ENV_FILE=../../.env.staging|' .env.staging

# Negative: staging Services needs a separate explicit approval, plus real policy.
sed -i 's|^FEATURE_SERVICES=false|FEATURE_SERVICES=true|' .env.staging
if bash infra/scripts/staging-preflight.sh >/dev/null 2>&1; then
  echo "[FAIL] Services was enabled without explicit staging approval" >&2; exit 1
fi
if ALLOW_STAGING_SERVICES=true bash infra/scripts/staging-preflight.sh >/dev/null 2>&1; then
  echo "[FAIL] Services was enabled without valid policy/salt" >&2; exit 1
fi

echo "[PASS] Both unsafe staging configurations were rejected."
