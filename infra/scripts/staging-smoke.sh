#!/usr/bin/env bash
# Verify a running staging deployment with real HTTPS endpoints.
# Usage: ./infra/scripts/staging-smoke.sh web.example.vn app.example.vn admin.example.vn api.example.vn
set -euo pipefail
[[ "$#" -eq 4 ]] || { echo "Usage: $0 WEB_DOMAIN PORTAL_DOMAIN ADMIN_DOMAIN API_DOMAIN" >&2; exit 1; }
for domain in "$@"; do
  [[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || { echo "Invalid domain: $domain" >&2; exit 1; }
done
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
check() {
  label="$1"; url="$2"
  status="$(curl --silent --show-error --location --connect-timeout 8 --max-time 30 --retry 2 -o "$TMP" -w '%{http_code}' "$url")" || { echo "[FAIL] $label not reachable"; exit 1; }
  if [[ "$status" != "200" ]]; then
    echo "[FAIL] $label returned HTTP $status"; exit 1
  fi
  echo "[PASS] $label HTTP $status"
}
check "Storefront" "https://$1/"
check "Customer portal" "https://$2/login"
check "Admin" "https://$3/login"
check "Public product API" "https://$4/products"
check "API readiness" "https://$4/health/readiness"
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$TMP" || { echo "[FAIL] API readiness did not report status=ok" >&2; exit 1; }
echo "[PASS] HTTP/HTTPS smoke checks completed; payment/auth/download still require manual end-to-end verification."
