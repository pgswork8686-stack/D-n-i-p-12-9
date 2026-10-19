#!/usr/bin/env bash
# Full-stack Playwright acceptance on a throwaway CI runner. No production data, services or credentials:
#  - CI-only PostgreSQL / Redis / MinIO prepared by the workflow (migrated + db:seed:local);
#  - the built API (test payment provider; SePay pointed at the local mock the AD10 spec serves) and worker;
#  - Storefront, Portal and Admin under `next dev`: the specs log in with dev tokens, and dev-token login
#    is compiled out whenever NODE_ENV === "production" (every `next build`).
# purchase-flow runs first so the Portal/Admin specs find a real paid order, entitlement and license; then
# every other full-stack spec (see e2e-suites.sh); then any skip that is not a desktop-only / phone-only
# skip fails the run, because it means a scenario was not exercised.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=infra/scripts/e2e-suites.sh
source infra/scripts/e2e-suites.sh

TMP="$(mktemp -d)"
RESULTS="$ROOT/apps/e2e/results"
PIDS=()

cleanup() {
  local code=$?
  mkdir -p "$RESULTS/server-logs"
  cp "$TMP"/*.log "$RESULTS/server-logs/" 2>/dev/null || true
  if [[ "$code" -ne 0 ]]; then
    echo "::group::Full-stack E2E server logs (tail)"
    for f in "$TMP"/*.log; do [[ -f "$f" ]] && { echo "---- $f"; tail -80 "$f"; }; done
    echo "::endgroup::"
  fi
  # Each service runs in its own process group (pnpm -> next dev -> its workers): stop the whole tree.
  for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
  exit "$code"
}
trap cleanup EXIT

start() {
  local label="$1"; shift
  setsid "$@" > "$TMP/$label.log" 2>&1 &
  PIDS+=("$!")
}

# Ready = the server answers with a non-5xx status (dynamic routes may legitimately 404). The first request
# to a `next dev` route compiles it, hence the long per-request limit.
wait_http() {
  local label="$1" url="$2" code=""
  for _ in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 "$url" || true)"
    if [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]; then echo "[ready] $label $url -> HTTP $code"; return 0; fi
    sleep 1
  done
  echo "[FAIL] $label did not become ready at $url (last HTTP $code)" >&2
  return 1
}

e2e_check_st01_specs "$ROOT"
mapfile -t SPECS < <(e2e_fullstack_specs "$ROOT")
REST=()
for spec in "${SPECS[@]}"; do [[ "$spec" == tests/purchase-flow.spec.ts ]] || REST+=("$spec"); done
if [[ "${#REST[@]}" -eq "${#SPECS[@]}" ]]; then echo "tests/purchase-flow.spec.ts is missing from the full-stack suite" >&2; exit 1; fi
echo "Full-stack specs: ${SPECS[*]}"

# A stale server on one of these ports would answer the readiness checks instead of the one started here.
for port in 3000 3001 3002 4000 4568; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "port $port is already in use" >&2; exit 1; fi
done

# One set of synthetic values, shared by the API and the specs (signatures must match on both sides).
export TEST_PAYMENT_WEBHOOK_SECRET="${TEST_PAYMENT_WEBHOOK_SECRET:-ci-test-payment-secret}"
export SEPAY_BANK_CODE=MB
export SEPAY_BANK_ACCOUNT=0123456789
export SEPAY_ACCOUNT_NAME="NEXUSTHEME CI"
export SEPAY_WEBHOOK_API_KEY=e2e-sepay-webhook-key-at-least-24-chars
export SEPAY_API_TOKEN=ci-sepay-api-token-not-a-real-token
export SEPAY_API_BASE_URL=http://localhost:4568
export E2E_SEPAY_MOCK_PORT=4568
unset SEPAY_PAYMENT_CODE_PREFIX NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS

echo "::group::Start API and worker"
start api env NODE_ENV=test PORT=4000 ENABLE_TEST_PAYMENT_PROVIDER=true node apps/api/dist/main.js
wait_http api http://localhost:4000/health/readiness
# purchase-flow and AD10 buy the demo product; seed it only when the database does not have it yet.
if [[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/products/klinmart)" == "404" ]]; then
  E2E_API_URL=http://localhost:4000 pnpm --filter @nexus/e2e seed:demo
fi
curl -fsS --max-time 10 http://localhost:4000/products/klinmart -o /dev/null
start worker env NODE_ENV=test node apps/worker/dist/index.js
echo "::endgroup::"

echo "::group::Start Storefront, Portal and Admin (next dev, dev-token login)"
NEXT_DEV=(env NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=http://localhost:4000)
# One app at a time: three cold `next dev` compiles in parallel starve a 2-vCPU runner.
start web "${NEXT_DEV[@]}" NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS=true INTERNAL_API_URL=http://localhost:4000 pnpm --filter @nexus/web dev
wait_http web http://localhost:3000/
wait_http web http://localhost:3000/products/klinmart
start portal "${NEXT_DEV[@]}" NEXT_PUBLIC_DEV_AUTH_ENABLED=true pnpm --filter @nexus/portal dev
wait_http portal http://localhost:3001/login
wait_http portal http://localhost:3001/orders
start admin "${NEXT_DEV[@]}" NEXT_PUBLIC_DEV_AUTH_ENABLED=true pnpm --filter @nexus/admin dev
wait_http admin http://localhost:3002/login
wait_http admin http://localhost:3002/admin/orders
# The worker must still be alive: purchase-flow waits for it to grant the entitlement and license.
kill -0 "${PIDS[1]}" || { echo "the worker exited" >&2; exit 1; }
echo "::endgroup::"

E2E=(env E2E_BASE_URL=http://localhost:3000 E2E_WEB_URL=http://localhost:3000 E2E_PORTAL_URL=http://localhost:3001
  E2E_ADMIN_URL=http://localhost:3002 E2E_API_URL=http://localhost:4000)
status=0

echo "::group::Purchase flow (creates the paid order, entitlement and license the other specs read)"
"${E2E[@]}" pnpm --filter @nexus/e2e exec playwright test tests/purchase-flow.spec.ts \
  --project=desktop-1440 --timeout=120000 --output=results/artifacts-purchase-flow || status=1
cp "$RESULTS/report.json" "$RESULTS/report-purchase-flow.json"
echo "::endgroup::"

echo "::group::Portal, Admin and payment reconciliation / 1440 768 390"
"${E2E[@]}" pnpm --filter @nexus/e2e exec playwright test "${REST[@]}" \
  --timeout=120000 --output=results/artifacts-fullstack || status=1
cp "$RESULTS/report.json" "$RESULTS/report-fullstack.json"
echo "::endgroup::"

node infra/scripts/e2e-skip-audit.mjs "$RESULTS/report-purchase-flow.json" "$RESULTS/report-fullstack.json" || status=1
exit "$status"
