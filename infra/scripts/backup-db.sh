#!/usr/bin/env bash
# Backup the PostgreSQL database, optionally encrypt it and copy it off the server.
#
# DB_ACCESS_MODE:
#   compose   (default) docker compose service "postgres" from the production stack
#   container docker container named by DB_CONTAINER (staging / drills / local)
#   direct    host pg_dump against POSTGRES_HOST:POSTGRES_PORT
#
# Encryption (required for anything leaving the server):
#   BACKUP_ENCRYPTION_KEY_FILE=/path/to/key   AES-256-CBC + PBKDF2 via openssl. The plaintext
#   .sql.gz is deleted after encryption unless BACKUP_KEEP_PLAINTEXT=true. Offsite copies are
#   ONLY the encrypted file. With an offsite target but no key file the script refuses to run
#   unless BACKUP_ALLOW_UNENCRYPTED_OFFSITE=true.
#
# Offsite (either or both):
#   BACKUP_R2_BUCKET (+ STORAGE_ENDPOINT, AWS credentials)  S3-compatible bucket via aws CLI
#   BACKUP_OFFSITE_DIR                                        mounted / synced directory
#
# Every successful run writes $BACKUP_DIR/.last-success (epoch seconds) for monitoring and a
# per-backup row-count manifest (<backup>.manifest.tsv) used by restore-drill.sh.
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf %s "$1"; fi; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${1:-$ROOT/backups}"
DB_ACCESS_MODE="${DB_ACCESS_MODE:-compose}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/production-compose.yml}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Runs a shell snippet inside the database environment (PGPASSWORD set from the container).
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

if [[ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]]; then
  [[ -s "$BACKUP_ENCRYPTION_KEY_FILE" ]] || { echo "[ERROR] BACKUP_ENCRYPTION_KEY_FILE is missing or empty" >&2; exit 1; }
  command -v openssl >/dev/null || { echo "[ERROR] openssl is required for encryption" >&2; exit 1; }
fi
OFFSITE_REQUESTED=false
[[ -n "${BACKUP_R2_BUCKET:-}" || -n "${BACKUP_OFFSITE_DIR:-}" ]] && OFFSITE_REQUESTED=true
if $OFFSITE_REQUESTED && [[ -z "${BACKUP_ENCRYPTION_KEY_FILE:-}" && "${BACKUP_ALLOW_UNENCRYPTED_OFFSITE:-false}" != "true" ]]; then
  echo "[ERROR] Offsite copy requested without BACKUP_ENCRYPTION_KEY_FILE; refusing to ship a plaintext dump." >&2
  exit 1
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else openssl dgst -sha256 "$1" | awk '{print $NF}'; fi
}

SAFE_DB_NAME="${DATABASE_NAME//[^a-zA-Z0-9_-]/_}"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/nexustheme_${SAFE_DB_NAME}_${STAMP}.sql.gz"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.nexustheme-backup-XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

echo "[INFO] Backing up database $DATABASE_NAME (mode=$DB_ACCESS_MODE)"
DUMP_CMD='exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists'
if [[ "$DB_ACCESS_MODE" == "direct" ]]; then
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" -d "$DATABASE_NAME" --no-owner --no-privileges --clean --if-exists | gzip -6 > "$TEMP_FILE"
else
  db_exec "$DUMP_CMD" | gzip -6 > "$TEMP_FILE"
fi
[[ -s "$TEMP_FILE" ]] && gzip -t "$TEMP_FILE" || { echo "[ERROR] Backup stream failed validation" >&2; exit 1; }
mv "$TEMP_FILE" "$BACKUP_FILE"
echo "$(sha256_of "$BACKUP_FILE")" > "$BACKUP_FILE.sha256"

# Exact per-table row counts at backup time; restore-drill.sh compares against these.
if [[ "$DB_ACCESS_MODE" != "direct" ]]; then
  COUNT_SQL="SELECT table_name || E'\\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;"
  db_exec "exec psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"$COUNT_SQL\"" | tr -d '\r' > "$BACKUP_FILE.manifest.tsv"
fi
echo "[OK] Local backup: $BACKUP_FILE"

SHIP_FILE="$BACKUP_FILE"
if [[ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]]; then
  SHIP_FILE="$BACKUP_FILE.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$(native_path "$BACKUP_FILE")" -out "$(native_path "$SHIP_FILE")" -pass "file:$(native_path "$BACKUP_ENCRYPTION_KEY_FILE")"
  echo "$(sha256_of "$SHIP_FILE")" > "$SHIP_FILE.sha256"
  [[ -f "$BACKUP_FILE.manifest.tsv" ]] && cp "$BACKUP_FILE.manifest.tsv" "$SHIP_FILE.manifest.tsv"
  echo "[OK] Encrypted copy: $SHIP_FILE"
  if [[ "${BACKUP_KEEP_PLAINTEXT:-false}" != "true" ]]; then
    rm -f "$BACKUP_FILE" "$BACKUP_FILE.sha256" "$BACKUP_FILE.manifest.tsv"
    echo "[OK] Plaintext dump removed from disk"
  fi
fi

OFFSITE_DONE=false
if [[ -n "${BACKUP_R2_BUCKET:-}" ]]; then
  command -v aws >/dev/null || { echo "[ERROR] BACKUP_R2_BUCKET set but aws CLI is missing; offsite backup NOT completed" >&2; exit 1; }
  : "${STORAGE_ENDPOINT:?STORAGE_ENDPOINT required for R2 backup}"
  for f in "$SHIP_FILE" "$SHIP_FILE.sha256" "$SHIP_FILE.manifest.tsv"; do
    [[ -f "$f" ]] && aws --endpoint-url "$STORAGE_ENDPOINT" s3 cp "$f" "s3://$BACKUP_R2_BUCKET/db-backups/"
  done
  echo "[OK] Offsite backup copied to bucket $BACKUP_R2_BUCKET"
  OFFSITE_DONE=true
fi
if [[ -n "${BACKUP_OFFSITE_DIR:-}" ]]; then
  mkdir -p "$BACKUP_OFFSITE_DIR"
  for f in "$SHIP_FILE" "$SHIP_FILE.sha256" "$SHIP_FILE.manifest.tsv"; do
    [[ -f "$f" ]] && cp "$f" "$BACKUP_OFFSITE_DIR/"
  done
  # Verify the copy byte-for-byte before claiming success.
  [[ "$(sha256_of "$BACKUP_OFFSITE_DIR/$(basename "$SHIP_FILE")")" == "$(cat "$SHIP_FILE.sha256")" ]] || { echo "[ERROR] Offsite copy checksum mismatch" >&2; exit 1; }
  echo "[OK] Offsite backup copied to $BACKUP_OFFSITE_DIR"
  OFFSITE_DONE=true
fi
$OFFSITE_DONE || echo "[WARNING] No offsite backup configured (set BACKUP_R2_BUCKET or BACKUP_OFFSITE_DIR)"

find "$BACKUP_DIR" -maxdepth 1 -name "nexustheme_${SAFE_DB_NAME}_*" -type f -mtime "+$RETENTION_DAYS" -delete
date -u +%s > "$BACKUP_DIR/.last-success"
$OFFSITE_DONE && date -u +%s > "$BACKUP_DIR/.last-offsite-success"
echo "[DONE] $(basename "$SHIP_FILE")"
