#!/usr/bin/env bash
# Restore drill: proves that the newest OFFSITE backup can really be restored.
#
# Pulls the latest *.sql.gz[.enc] from BACKUP_OFFSITE_DIR (or $1), verifies its checksum, decrypts
# it, restores it into a THROWAWAY postgres container (never the live database) and compares exact
# per-table row counts with the manifest written at backup time. Prints the measured restore time
# (your real RTO input) and writes a JSON report; exits non-zero on any mismatch.
#
# Usage: restore-drill.sh [offsite-dir]
# Env:   BACKUP_ENCRYPTION_KEY_FILE (needed for .enc), DRILL_IMAGE (default postgres:16-alpine),
#        DRILL_REPORT_DIR (default ./backups/drills), DRILL_MAX_SECONDS (fail if slower; default 1800)
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf %s "$1"; fi; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-${BACKUP_OFFSITE_DIR:-}}"
[[ -d "$SRC_DIR" ]] || { echo "Usage: $0 <offsite-dir> (or set BACKUP_OFFSITE_DIR)" >&2; exit 1; }
IMAGE="${DRILL_IMAGE:-postgres:16-alpine}"
REPORT_DIR="${DRILL_REPORT_DIR:-$ROOT/backups/drills}"
MAX_SECONDS="${DRILL_MAX_SECONDS:-1800}"
mkdir -p "$REPORT_DIR"
command -v docker >/dev/null || { echo "Docker is required for the drill" >&2; exit 1; }

LATEST="$(ls -1 "$SRC_DIR"/nexustheme_*.sql.gz "$SRC_DIR"/nexustheme_*.sql.gz.enc 2>/dev/null | sort | tail -n 1 || true)"
[[ -n "$LATEST" ]] || { echo "[FAIL] No backups found in $SRC_DIR" >&2; exit 2; }
echo "[INFO] Drilling with $(basename "$LATEST")"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else openssl dgst -sha256 "$1" | awk '{print $NF}'; fi
}
[[ -f "$LATEST.sha256" ]] || { echo "[FAIL] Missing checksum file" >&2; exit 3; }
[[ "$(sha256_of "$LATEST")" == "$(awk '{print $1}' "$LATEST.sha256")" ]] || { echo "[FAIL] Checksum mismatch (corrupt or tampered offsite copy)" >&2; exit 3; }

stream() {
  if [[ "$LATEST" == *.enc ]]; then
    [[ -s "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]] || { echo "[FAIL] Encrypted backup needs BACKUP_ENCRYPTION_KEY_FILE" >&2; exit 4; }
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$(native_path "$LATEST")" -pass "file:$(native_path "$BACKUP_ENCRYPTION_KEY_FILE")"
  else cat "$LATEST"; fi
}

NAME="nexus-restore-drill-$$"
PASS="drill-$(date +%s)-$RANDOM"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

START=$(date +%s)
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_USER=drill -e POSTGRES_DB=drill "$IMAGE" >/dev/null
# The init-time temporary server only listens on the unix socket, so wait for the real TCP server.
READY=false
for _ in $(seq 1 90); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U drill -d drill >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
$READY || { echo "[FAIL] Drill database did not start" >&2; exit 5; }

stream | gzip -dc | docker exec -i "$NAME" psql -U drill -d drill -q --single-transaction --set ON_ERROR_STOP=on -o /dev/null
END=$(date +%s)
SECONDS_TAKEN=$((END - START))

COUNT_SQL="SELECT table_name || E'\\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;"
ACTUAL="$(docker exec "$NAME" psql -U drill -d drill -tA -c "$COUNT_SQL" | tr -d '\r')"
STATUS="PASS"; DETAIL="restored; no manifest to compare"
if [[ -f "$LATEST.manifest.tsv" ]]; then
  EXPECTED="$(tr -d '\r' < "$LATEST.manifest.tsv")"
  if [[ "$EXPECTED" == "$ACTUAL" ]]; then
    DETAIL="$(printf '%s\n' "$ACTUAL" | wc -l | tr -d ' ') tables, exact row counts match manifest"
  else
    STATUS="FAIL"; DETAIL="row counts differ from manifest"
    diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$ACTUAL") >&2 || true
  fi
fi
(( SECONDS_TAKEN <= MAX_SECONDS )) || { STATUS="FAIL"; DETAIL="$DETAIL; restore took ${SECONDS_TAKEN}s > ${MAX_SECONDS}s"; }

REPORT="$REPORT_DIR/drill_$(date -u +%Y%m%d_%H%M%S).json"
printf '{"status":"%s","backup":"%s","encrypted":%s,"restoreSeconds":%s,"detail":"%s","finishedAt":"%s"}\n' \
  "$STATUS" "$(basename "$LATEST")" "$([[ "$LATEST" == *.enc ]] && echo true || echo false)" "$SECONDS_TAKEN" "$DETAIL" "$(date -u +%FT%TZ)" > "$REPORT"
cat "$REPORT"
[[ "$STATUS" == "PASS" ]] && date -u +%s > "$REPORT_DIR/.last-pass"
[[ "$STATUS" == "PASS" ]] || exit 6
