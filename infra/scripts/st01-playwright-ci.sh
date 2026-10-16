#!/usr/bin/env bash
# ST01 Playwright acceptance on ephemeral CI infrastructure, no production writes.
# Designed to run AFTER CI's database setup, pnpm build and Services acceptance.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
API_PID=0
WEB_PID=0
IMAGES_PID=0

cleanup() {
  local result=$?
  if [[ "$result" -ne 0 ]]; then
    echo "::group::ST01 E2E startup/debug logs"
    for f in "$TMP/api.log" "$TMP/web.log" "$TMP/images.log"; do
      if [[ -f "$f" ]]; then echo "---- $f"; tail -100 "$f" || true; fi
    done
    echo "::endgroup::"
  fi
  for pid in "$API_PID" "$WEB_PID" "$IMAGES_PID"; do
    if [[ "$pid" != 0 ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

# Simple in-process placeholder server: only on this throwaway CI runner.
# Seed data refer to localhost:9232/*.jpg/png; serve valid PNG bytes
# without fetching external assets or adding image binaries to the repo.
cat > "$TMP/images.py" <<'PY'
import http.server
import struct
import zlib

def chunk(tag, payload):
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xffffffff)

w, h = 32, 32
pixels = b"".join(b"\x00" + b"\x31\x55\xd9" * w for _ in range(h))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(pixels))
       + chunk(b"IEND", b""))

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.end_headers()
        self.wfile.write(png)
    def log_message(self, *args):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", 9232), Handler).serve_forever()
PY
python3 -u "$TMP/images.py" > "$TMP/images.log" 2>&1 &
IMAGES_PID=$!

echo "::group::Start isolated development-auth API (Services off = CTA)"
NODE_ENV=test FEATURE_SERVICES=false PORT=4000 \
  node apps/api/dist/main.js > "$TMP/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/v1/features -o /dev/null; then break; fi
  if [[ "$i" == 60 ]]; then echo "API did not start" >&2; exit 1; fi
  sleep 1
done

mkdir -p apps/e2e/results
E2E_API_URL=http://localhost:4000 pnpm --filter @nexus/e2e seed:demo
test -s apps/e2e/results/demo-media.sql
# Products and content imagery belong ONLY to this CI test DB.
docker exec -i nexustheme-postgres psql -v ON_ERROR_STOP=1 -U postgres -d marketplace \
  < apps/e2e/results/demo-media.sql
echo "::endgroup::"

echo "::group::Start built Storefront"
# Canonical/public metadata must keep a non-loopback HTTPS origin in production.
# Browser navigation still uses the local HTTP test server through E2E_BASE_URL.
NODE_ENV=production NEXT_PUBLIC_SITE_URL=https://st01-ci.example.invalid INTERNAL_API_URL=http://localhost:4000 \
  pnpm --filter @nexus/web start > "$TMP/web.log" 2>&1 &
WEB_PID=$!
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/ -o /dev/null; then break; fi
  if [[ "$i" == 60 ]]; then echo "Storefront did not start" >&2; exit 1; fi
  sleep 1
done
echo "::endgroup::"

echo "::group::ST01 Playwright CTA / 1440 768 390 / axe WCAG"
pnpm --filter @nexus/e2e exec playwright install --with-deps chromium
E2E_CONSULT_MODE=cta \
E2E_BASE_URL=http://localhost:3000 \
E2E_API_URL=http://localhost:4000 \
  pnpm --filter @nexus/e2e test:e2e
echo "::endgroup::"

# ---------------------------------------------------------------------------
# Real consultation form. Same throwaway runner: the API is restarted with the Services module
# on and an explicit consent policy, the Storefront (which asks the API on every request) is left
# running, and the tests that were skipped in CTA mode now run. Afterwards the stored data, the
# outbox event, the worker and the staff notification are checked directly in the CI database.
# ---------------------------------------------------------------------------
echo "::group::Restart API with Services on (form mode)"
kill "$API_PID" 2>/dev/null || true
wait "$API_PID" 2>/dev/null || true
CONSENT_VERSION="ci-e2e-1"
NODE_ENV=test FEATURE_SERVICES=true PORT=4000 \
  SERVICE_CONSENT_VERSION="$CONSENT_VERSION" PRIVACY_POLICY_URL=https://st01-ci.example.invalid/privacy \
  SERVICE_INQUIRY_IP_SALT=ci-e2e-salt-0123456789abcdef0123456789 \
  SERVICE_INQUIRY_RATE_LIMIT_PER_IP=50 SERVICE_INQUIRY_RATE_LIMIT_PER_EMAIL=50 \
  node apps/api/dist/main.js > "$TMP/api-form.log" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/v1/service-inquiries/consent -o "$TMP/consent.json"; then break; fi
  if [[ "$i" == 60 ]]; then echo "API (Services on) did not start" >&2; tail -50 "$TMP/api-form.log" >&2 || true; exit 1; fi
  sleep 1
done
grep -q "\"version\":\"$CONSENT_VERSION\"" "$TMP/consent.json"
curl -fsS http://127.0.0.1:4000/v1/services | grep -q '"custom-web-app-development"'
echo "::endgroup::"

echo "::group::ST01 Playwright real form / 1440 768 390 / axe WCAG"
E2E_CONSULT_MODE=form \
E2E_BASE_URL=http://localhost:3000 \
E2E_API_URL=http://localhost:4000 \
  pnpm --filter @nexus/e2e test:e2e
echo "::endgroup::"

echo "::group::Verify the stored inquiry, outbox, worker and staff notification"
psql_q() { docker exec -i nexustheme-postgres psql -v ON_ERROR_STOP=1 -U postgres -d marketplace -tA -F '|' -c "$1"; }
ROW="$(psql_q "SELECT id, inquiry_number, consent_version, marketing_consent, (consent_at IS NOT NULL), (marketing_consent_at IS NULL), user_id IS NULL FROM service_inquiries WHERE contact_email LIKE 'e2e-%@example.com' ORDER BY created_at DESC LIMIT 1")"
test -n "$ROW" || { echo "no inquiry from the E2E form was stored" >&2; exit 1; }
IFS='|' read -r INQ_ID INQ_NO C_VER C_MKT C_AT C_MKT_AT_NULL ANON <<< "$ROW"
echo "inquiry $INQ_NO ($INQ_ID) consent=$C_VER marketing=$C_MKT"
[[ "$INQ_NO" =~ ^SI-[0-9]{6}-[0-9A-F]{6}$ ]]                 # the reference the customer saw
[[ "$C_VER" == "$CONSENT_VERSION" ]]                          # server-recorded policy version
[[ "$C_AT" == "t" && "$C_MKT" == "f" && "$C_MKT_AT_NULL" == "t" ]]  # consent time set, marketing not implied
[[ "$ANON" == "t" ]]                                          # anonymous visitor, no account linked
[[ "$(psql_q "SELECT count(*) FROM service_inquiries WHERE contact_email LIKE 'e2e-%@example.com' AND id='$INQ_ID'")" == "1" ]]

# Outbox event exists, is still pending (nothing processed it inline), and carries no personal data.
[[ "$(psql_q "SELECT status FROM outbox_events WHERE event_type='SERVICE_INQUIRY_CREATED' AND aggregate_id='$INQ_ID'")" == "PENDING" ]]
if psql_q "SELECT payload::text FROM outbox_events WHERE aggregate_id='$INQ_ID'" | grep -Eqi 'example\.com|0901|website bán hàng|Khách E2E'; then
  echo "outbox payload leaks personal data" >&2; exit 1
fi
[[ "$(psql_q "SELECT count(*) FROM notifications WHERE type='SERVICE_INQUIRY_CREATED' AND metadata->>'inquiryId'='$INQ_ID'")" == "0" ]]

# The real worker code processes it.
node -e "require('./apps/worker/dist/outbox-processor.js').processOutboxEvents({workerId:'ci-e2e',batchSize:50}).then(r=>{console.log('processed',r.processedCount);process.exit(0)},e=>{console.error(e);process.exit(1)})"
[[ "$(psql_q "SELECT status FROM outbox_events WHERE event_type='SERVICE_INQUIRY_CREATED' AND aggregate_id='$INQ_ID'")" == "PROCESSED" ]]
NOTICES="$(psql_q "SELECT count(*) FROM notifications WHERE type='SERVICE_INQUIRY_CREATED' AND metadata->>'inquiryId'='$INQ_ID'")"
echo "staff notified: $NOTICES"
[[ "$NOTICES" -ge 1 ]]
[[ "$(psql_q "SELECT count(*) FROM audit_logs WHERE action='SERVICE_INQUIRY_NOTIFIED' AND entity_id='$INQ_ID'")" == "1" ]]
# Staff-only: every recipient holds a role that grants inquiry access.
[[ "$(psql_q "SELECT count(*) FROM notifications n WHERE n.type='SERVICE_INQUIRY_CREATED' AND n.metadata->>'inquiryId'='$INQ_ID' AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=n.user_id AND (r.name='super_admin' OR p.name='inquiry.read'))")" == "0" ]]
echo "::endgroup::"
