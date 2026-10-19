#!/usr/bin/env bash
# Restore drill: proves that the newest OFFSITE backup can really be restored.
#
# Pulls the newest *.sql.gz.enc from BACKUP_OFFSITE_DIR (or $1) and, in this order:
#   1. verifies the HMAC authentication tag (dump + manifest + checksum cannot have been altered without the key)
#   2. decrypts the dump and the manifest
#   3. restores the dump into a THROWAWAY postgres container (never the live database)
#   4. compares EXACT per-table row counts with the manifest (a missing or empty manifest is a FAILURE)
# Prints the measured restore time (real RTO input) and writes a JSON report; exits non-zero on ANY problem.
# Plaintext archives are refused: offsite copies are always encrypted, so there is no plaintext path.
#
# Usage: restore-drill.sh [offsite-dir]
# Env:   BACKUP_ENCRYPTION_KEY_FILE (required), DRILL_IMAGE (default postgres:16-alpine),
#        DRILL_REPORT_DIR (default ./backups/drills), DRILL_MAX_SECONDS (default 1800)
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=backup-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
SRC_DIR="${1:-${BACKUP_OFFSITE_DIR:-}}"
[[ -d "$SRC_DIR" ]] || { echo "Usage: $0 <offsite-dir> (or set BACKUP_OFFSITE_DIR)" >&2; exit 1; }
KEY="${BACKUP_ENCRYPTION_KEY_FILE:-}"
[[ -s "$KEY" ]] || { echo "[FAIL] BACKUP_ENCRYPTION_KEY_FILE is required" >&2; exit 4; }
IMAGE="${DRILL_IMAGE:-postgres:16-alpine}"
REPORT_DIR="${DRILL_REPORT_DIR:-$ROOT/backups/drills}"
MAX_SECONDS="${DRILL_MAX_SECONDS:-1800}"
mkdir -p "$REPORT_DIR"
command -v docker >/dev/null || { echo "Docker is required for the drill" >&2; exit 1; }

if ls "$SRC_DIR"/nexustheme_*.sql.gz >/dev/null 2>&1; then
  echo "[FAIL] Plaintext backup found in the offsite location ($(basename "$(ls "$SRC_DIR"/nexustheme_*.sql.gz | head -n 1)")). Offsite copies must be encrypted." >&2
  exit 5
fi
LATEST="$(ls -1 "$SRC_DIR"/nexustheme_*.sql.gz.enc 2>/dev/null | sort | tail -n 1 || true)"
[[ -n "$LATEST" ]] || { echo "[FAIL] No encrypted backups found in $SRC_DIR" >&2; exit 2; }
echo "[INFO] Drilling with $(basename "$LATEST")"

verify_backup_mac "$LATEST" "$KEY" || exit 3

TMP="$(mktemp -d)"
NAME="nexus-restore-drill-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
decrypt_stream "$LATEST.manifest.enc" "$KEY" | tr -d '\r' > "$TMP/manifest.tsv" || { echo "[FAIL] Cannot decrypt the manifest" >&2; exit 3; }
[[ -s "$TMP/manifest.tsv" ]] || { echo "[FAIL] Manifest is empty; a restore cannot be proven" >&2; exit 3; }
decrypt_stream "$LATEST" "$KEY" | gzip -t || { echo "[FAIL] Dump does not decrypt to a valid gzip stream" >&2; exit 3; }

PASS="drill-$(date +%s)-$RANDOM"
START=$(date +%s)
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_USER=drill -e POSTGRES_DB=drill "$IMAGE" >/dev/null
# The init-time temporary server only listens on the unix socket, so wait for the real TCP server.
READY=false
for _ in $(seq 1 90); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U drill -d drill >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
$READY || { echo "[FAIL] Drill database did not start" >&2; exit 5; }

decrypt_stream "$LATEST" "$KEY" | gzip -dc | docker exec -i "$NAME" psql -U drill -d drill -q --single-transaction --set ON_ERROR_STOP=on -o /dev/null
END=$(date +%s)
SECONDS_TAKEN=$((END - START))

COUNT_SQL="SELECT table_name || E'\\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;"
ACTUAL="$(docker exec "$NAME" psql -U drill -d drill -tA -c "$COUNT_SQL" | tr -d '\r')"
EXPECTED="$(cat "$TMP/manifest.tsv")"
STATUS="PASS"
if [[ "$EXPECTED" == "$ACTUAL" ]]; then
  DETAIL="$(printf '%s\n' "$ACTUAL" | wc -l | tr -d ' ') tables, exact row counts match the authenticated manifest"
else
  STATUS="FAIL"; DETAIL="row counts differ from the manifest"
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$ACTUAL") >&2 || true
fi
(( SECONDS_TAKEN <= MAX_SECONDS )) || { STATUS="FAIL"; DETAIL="$DETAIL; restore took ${SECONDS_TAKEN}s > ${MAX_SECONDS}s"; }

REPORT="$REPORT_DIR/drill_$(date -u +%Y%m%d_%H%M%S).json"
printf '{"status":"%s","backup":"%s","authenticated":true,"restoreSeconds":%s,"detail":"%s","finishedAt":"%s"}\n' \
  "$STATUS" "$(basename "$LATEST")" "$SECONDS_TAKEN" "$DETAIL" "$(date -u +%FT%TZ)" > "$REPORT"
cat "$REPORT"
if [[ "$STATUS" == "PASS" ]]; then date -u +%s > "$REPORT_DIR/.last-pass"; fi
[[ "$STATUS" == "PASS" ]] || exit 6