#!/usr/bin/env bash
# Backup the PostgreSQL database, encrypt it, authenticate it and copy it off the server.
#
# DB_ACCESS_MODE:
#   compose   (default) docker compose service "postgres" from the production stack
#   container docker container named by DB_CONTAINER (staging / drills / local)
#   direct    host pg_dump against POSTGRES_HOST:POSTGRES_PORT (no manifest, local-only, dev use)
#
# Encryption is MANDATORY for anything that leaves this host. There is no override: if BACKUP_R2_BUCKET or
# BACKUP_OFFSITE_DIR is set and BACKUP_ENCRYPTION_KEY_FILE is not, the script refuses to run. What is shipped:
#   <backup>.sql.gz.enc            encrypted dump (AES-256-CBC + PBKDF2)
#   <backup>.sql.gz.enc.manifest.enc  encrypted per-table row counts (no plaintext metadata leaves the host)
#   <backup>.sql.gz.enc.hmac       HMAC-SHA256 over the dump hash + manifest hash, separate derived key
#   <backup>.sql.gz.enc.sha256     plain checksum (convenience; the HMAC is the real integrity proof)
# The plaintext dump and manifest are deleted from disk after encryption (also on failure).
# BACKUP_KEEP_PLAINTEXT=true keeps a LOCAL plaintext copy only and is rejected when any offsite target is set.
#
# Offsite targets (either or both): BACKUP_R2_BUCKET (+ STORAGE_ENDPOINT, AWS credentials) and BACKUP_OFFSITE_DIR.
# Heartbeats for monitoring: $BACKUP_DIR/.last-success and .last-offsite-success (epoch seconds).
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=backup-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
BACKUP_DIR="${1:-$ROOT/backups}"
DB_ACCESS_MODE="${DB_ACCESS_MODE:-compose}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/production-compose.yml}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
PG_ENV='export PGPASSWORD="$POSTGRES_PASSWORD";'
db_exec() {
  case "$DB_ACCESS_MODE" in
    compose)   compose exec -T postgres sh -ec "$PG_ENV $1" ;;
    container) docker exec -i "$DB_CONTAINER" sh -ec "$PG_ENV $1" ;;
  esac
}

case "$DB_ACCESS_MODE" in
  compose)
    [[ -f "$COMPOSE_ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Missing production Compose configuration" >&2; exit 1; }
    command -v docker >/dev/null || { echo "Docker is required for compose backup mode" >&2; exit 1; }
    DATABASE_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')" ;;
  container)
    : "${DB_CONTAINER:?DB_CONTAINER is required in container mode}"
    DATABASE_NAME="$(docker exec "$DB_CONTAINER" printenv POSTGRES_DB | tr -d '\r')" ;;
  direct)
    : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required in direct mode}"
    DATABASE_NAME="${POSTGRES_DB:-marketplace}" ;;
  *) echo "Unsupported DB_ACCESS_MODE=$DB_ACCESS_MODE (compose|container|direct)" >&2; exit 1 ;;
esac
[[ -n "$DATABASE_NAME" ]] || { echo "Database name is empty" >&2; exit 1; }

OFFSITE_REQUESTED=false
[[ -n "${BACKUP_R2_BUCKET:-}" || -n "${BACKUP_OFFSITE_DIR:-}" ]] && OFFSITE_REQUESTED=true
ENCRYPT=false
if [[ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]]; then
  [[ -s "$BACKUP_ENCRYPTION_KEY_FILE" ]] || { echo "[ERROR] BACKUP_ENCRYPTION_KEY_FILE is missing or empty" >&2; exit 1; }
  command -v openssl >/dev/null || { echo "[ERROR] openssl is required for encryption" >&2; exit 1; }
  ENCRYPT=true
fi
if $OFFSITE_REQUESTED && ! $ENCRYPT; then
  echo "[ERROR] An offsite target is configured but BACKUP_ENCRYPTION_KEY_FILE is not. Refusing to ship a plaintext dump (there is no override)." >&2
  exit 1
fi
if $OFFSITE_REQUESTED && [[ "${BACKUP_KEEP_PLAINTEXT:-false}" == "true" ]]; then
  echo "[ERROR] BACKUP_KEEP_PLAINTEXT=true is not allowed together with an offsite target." >&2
  exit 1
fi
if $OFFSITE_REQUESTED && [[ "$DB_ACCESS_MODE" == "direct" ]]; then
  echo "[ERROR] Offsite backups need a manifest; direct mode produces none. Use compose or container mode." >&2
  exit 1
fi

SAFE_DB_NAME="${DATABASE_NAME//[^a-zA-Z0-9_-]/_}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/nexustheme_${SAFE_DB_NAME}_${STAMP}.sql.gz"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.nexustheme-backup-XXXXXX")"
MANIFEST_FILE="$BACKUP_FILE.manifest.tsv"
cleanup() {
  rm -f "$TEMP_FILE"
  # Never leave plaintext behind when the backup is meant to be encrypted, even if a later step failed.
  if $ENCRYPT && [[ "${BACKUP_KEEP_PLAINTEXT:-false}" != "true" ]]; then
    rm -f "$BACKUP_FILE" "$BACKUP_FILE.sha256" "$MANIFEST_FILE"
  fi
}
trap cleanup EXIT

echo "[INFO] Backing up database $DATABASE_NAME (mode=$DB_ACCESS_MODE, encrypted=$ENCRYPT)"
DUMP_CMD='exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists'
if [[ "$DB_ACCESS_MODE" == "direct" ]]; then
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" -d "$DATABASE_NAME" --no-owner --no-privileges --clean --if-exists | gzip -6 > "$TEMP_FILE"
else
  db_exec "$DUMP_CMD" | gzip -6 > "$TEMP_FILE"
fi
[[ -s "$TEMP_FILE" ]] && gzip -t "$TEMP_FILE" || { echo "[ERROR] Backup stream failed validation" >&2; exit 1; }
mv "$TEMP_FILE" "$BACKUP_FILE"
echo "$(sha256_of "$BACKUP_FILE")" > "$BACKUP_FILE.sha256"

# Exact per-table row counts at backup time; restore-drill.sh proves the restore against them.
if [[ "$DB_ACCESS_MODE" != "direct" ]]; then
  COUNT_SQL="SELECT table_name || E'\\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;"
  db_exec "exec psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"$COUNT_SQL\"" | tr -d '\r' > "$MANIFEST_FILE"
  [[ -s "$MANIFEST_FILE" ]] || { echo "[ERROR] Manifest is empty (no tables found); refusing to continue" >&2; exit 1; }
fi
echo "[OK] Local backup: $BACKUP_FILE"

SHIP_FILE="$BACKUP_FILE"
SHIP_SET=("$BACKUP_FILE" "$BACKUP_FILE.sha256")
if $ENCRYPT; then
  SHIP_FILE="$BACKUP_FILE.enc"
  encrypt_file "$BACKUP_FILE" "$SHIP_FILE" "$BACKUP_ENCRYPTION_KEY_FILE"
  encrypt_file "$MANIFEST_FILE" "$SHIP_FILE.manifest.enc" "$BACKUP_ENCRYPTION_KEY_FILE"
  echo "$(sha256_of "$SHIP_FILE")" > "$SHIP_FILE.sha256"
  mac_tag "$SHIP_FILE" "$SHIP_FILE.manifest.enc" "$BACKUP_ENCRYPTION_KEY_FILE" > "$SHIP_FILE.hmac"
  verify_backup_mac "$SHIP_FILE" "$BACKUP_ENCRYPTION_KEY_FILE" || { echo "[ERROR] Freshly written backup failed its own authentication check" >&2; exit 1; }
  SHIP_SET=("$SHIP_FILE" "$SHIP_FILE.sha256" "$SHIP_FILE.manifest.enc" "$SHIP_FILE.hmac")
  echo "[OK] Encrypted + authenticated: $SHIP_FILE"
else
  echo "[WARNING] No BACKUP_ENCRYPTION_KEY_FILE: this backup is plaintext and LOCAL ONLY (development use)."
fi

OFFSITE_DONE=false
if [[ -n "${BACKUP_R2_BUCKET:-}" ]]; then
  command -v aws >/dev/null || { echo "[ERROR] BACKUP_R2_BUCKET set but aws CLI is missing; offsite backup NOT completed" >&2; exit 1; }
  : "${STORAGE_ENDPOINT:?STORAGE_ENDPOINT required for R2 backup}"
  for f in "${SHIP_SET[@]}"; do
    aws --endpoint-url "$STORAGE_ENDPOINT" s3 cp "$f" "s3://$BACKUP_R2_BUCKET/db-backups/"
  done
  echo "[OK] Offsite backup copied to bucket $BACKUP_R2_BUCKET"
  OFFSITE_DONE=true
fi
if [[ -n "${BACKUP_OFFSITE_DIR:-}" ]]; then
  mkdir -p "$BACKUP_OFFSITE_DIR"
  for f in "${SHIP_SET[@]}"; do cp "$f" "$BACKUP_OFFSITE_DIR/"; done
  # Prove the copy byte-for-byte and cryptographically before claiming success.
  verify_backup_mac "$BACKUP_OFFSITE_DIR/$(basename "$SHIP_FILE")" "$BACKUP_ENCRYPTION_KEY_FILE" || { echo "[ERROR] Offsite copy failed verification" >&2; exit 1; }
  echo "[OK] Offsite backup copied to $BACKUP_OFFSITE_DIR"
  OFFSITE_DONE=true
fi
$OFFSITE_DONE || echo "[WARNING] No offsite backup configured (set BACKUP_R2_BUCKET or BACKUP_OFFSITE_DIR)"

find "$BACKUP_DIR" -maxdepth 1 -name "nexustheme_${SAFE_DB_NAME}_*" -type f -mtime "+$RETENTION_DAYS" -delete
date -u +%s > "$BACKUP_DIR/.last-success"
if $OFFSITE_DONE; then date -u +%s > "$BACKUP_DIR/.last-offsite-success"; fi
echo "[DONE] $(basename "$SHIP_FILE")"