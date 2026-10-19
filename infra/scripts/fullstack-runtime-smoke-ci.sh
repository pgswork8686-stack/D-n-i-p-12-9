#!/usr/bin/env bash
# Disposable runtime smoke: boot API + ALL three built Next.js apps against
# CI-only PostgreSQL / Redis / MinIO. No external services or production data.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
PIDS=()
cleanup() {
  code=$?
  if [[ "$code" -ne 0 ]]; then
    for file in "$TMP"/*.log; do [[ -f "$file" ]] && { echo "--- $file"; tail -80 "$file"; }; done
  fi
  # Next.js is launched through pnpm. Killing only the pnpm parent can leave
  # next-server listening on its old port and corrupt the following E2E job.
  # Each start() runs in an isolated process group: stop its entire tree.
  for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
  exit "$code"
}
trap cleanup EXIT

start() {
  label="$1"; shift
  # Isolate the entire service tree (including pnpm -> next start).
  setsid "$@" > "$TMP/$label.log" 2>&1 &
  PIDS+=("$!")
}

wait_http() {
  label="$1"; url="$2"
  for i in $(seq 1 80); do
    if curl -fsS --max-time 3 "$url" -o "$TMP/$label.response"; then
      printf '[PASS] %s ready: %s\n' "$label" "$url"
      return
    fi
    sleep 1
  done
  echo "[FAIL] $label did not become ready at $url" >&2
  return 1
}

# NODE_ENV=test and fake credentials are supplied by the isolated CI job.
start api env NODE_ENV=test FEATURE_SERVICES=false PORT=4000 node apps/api/dist/main.js
wait_http api http://127.0.0.1:4000/health/readiness
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$TMP/api.response"

# Keep the same localhost API as used by CI, not untrusted production endpoints.
start web env NODE_ENV=production INTERNAL_API_URL=http://127.0.0.1:4000 pnpm --filter @nexus/web start
start portal env NODE_ENV=production pnpm --filter @nexus/portal start
start admin env NODE_ENV=production pnpm --filter @nexus/admin start

wait_http web http://127.0.0.1:3000/
wait_http portal http://127.0.0.1:3001/login
wait_http admin http://127.0.0.1:3002/login

for label in web portal admin; do
  if ! grep -Eqi '<!doctype html|<html' "$TMP/$label.response"; then
    echo "[FAIL] $label returned no HTML document" >&2
    exit 1
  fi
done

# Confirm API serves actual JSON, not just an open port.
curl -fsS --max-time 5 http://127.0.0.1:4000/v1/features -o "$TMP/features.json"
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if (v === null || typeof v !== "object" || Array.isArray(v)) process.exit(1);
' "$TMP/features.json"

echo "[PASS] Four real HTTP processes: API, Storefront, Portal, Admin."
echo "[NOTE] CI uses synthetic users/payment credentials. Supabase login, private R2,"
echo "       n8n delivery, and provider payment are NOT live staging-verified."
