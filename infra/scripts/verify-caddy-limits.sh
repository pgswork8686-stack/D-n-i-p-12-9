#!/usr/bin/env bash
# Check the production Caddyfile on an isolated Docker network.
# Requires Docker, curl, and truncate (provided by GitHub ubuntu-latest).
set -euo pipefail

CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10-alpine}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NETWORK="pgs-caddy-limits-${GITHUB_RUN_ID:-local}-$$"
BACKEND="pgs-caddy-backend-$$"
PROXY="pgs-caddy-proxy-$$"
PORT=19808
TMP="$(mktemp -d)"
PASSED=0

cleanup() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    docker logs "$PROXY" 2>&1 | tail -100 || true
    docker logs "$BACKEND" 2>&1 | tail -60 || true
  fi
  docker rm -f "$PROXY" "$BACKEND" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

caddy_env=(
  -e ACME_EMAIL=ci@example.invalid
  -e WEB_DOMAIN=web.example.invalid
  -e PORTAL_DOMAIN=portal.example.invalid
  -e ADMIN_DOMAIN=admin.example.invalid
  -e API_DOMAIN="http://:${PORT}"
)

echo "::group::Validate the production Caddyfile"
docker run --rm "${caddy_env[@]}" \
  -v "${ROOT}/infra/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
echo "::endgroup::"

docker network create "$NETWORK" >/dev/null
# Consume the entire request body: a backend responding early can mask
# missing streaming body-size enforcement by the reverse proxy.
docker run -d --name "$BACKEND" --network "$NETWORK" --network-alias api \
  node:22-alpine node -e 'const http=require("node:http");http.createServer((req,res)=>{req.on("data",()=>{});req.on("end",()=>{res.writeHead(200);res.end("OK")})}).listen(4000,"0.0.0.0")' >/dev/null

docker run -d --name "$PROXY" --network "$NETWORK" \
  -p "127.0.0.1:${PORT}:${PORT}" "${caddy_env[@]}" \
  -v "${ROOT}/infra/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/ready" -o /dev/null; then
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "Caddy did not start on port ${PORT}" >&2
    exit 1
  fi
  sleep 1
done

post_body() {
  local path="$1" bytes="$2" expected="$3"
  truncate -s "$bytes" "$TMP/payload"
  local got
  got="$(curl -s --max-time 90 --http1.1 -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/octet-stream' \
    --data-binary "@$TMP/payload" "http://127.0.0.1:${PORT}${path}" || true)"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL ${path} (${bytes} bytes): expected HTTP ${expected}, got ${got}" >&2
    exit 1
  fi
  PASSED=$((PASSED + 1))
  echo "PASS ${path}: ${bytes} bytes -> HTTP $got"
}

echo "::group::Check real HTTP 413/200 on production route rules"
# Default = 5 MiB.
post_body "/v1/products"                      6291456   413
post_body "/v1/products"                      1048576   200
# Customer/staff project documents = 13 MiB.
post_body "/v1/me/service-projects/123/documents"    6291456   200
post_body "/v1/admin/service-projects/123/documents" 13631489  413
# Inquiry form = 53 MiB, not caught by default 5 MiB limit.
post_body "/v1/service-inquiries"             6291456   200
post_body "/v1/service-inquiries"             55574529  413
# Product-version archive = 60 MiB; optional /v1 prefix.
post_body "/v1/admin/product-versions/123/files/upload" 6291456  200
post_body "/admin/product-versions/123/files/upload" 62914561 413
echo "::endgroup::"
echo "Caddy validation and ${PASSED} HTTP boundary checks passed."
