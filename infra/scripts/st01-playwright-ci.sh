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
