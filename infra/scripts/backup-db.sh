#!/usr/bin/env bash
# Backup the production PostgreSQL container without exposing port 5432.
# DB_ACCESS_MODE=compose (default) or direct (external/Postgres development).
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${1:-$ROOT/backups}"
DB_ACCESS_MODE="${DB_ACCESS_MODE:-compose}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/production-compose.yml}"
mkdir -p "$BACKUP_DIR"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
if [[ "$DB_ACCESS_MODE" == "compose" ]]; then
  [[ -f "$COMPOSE_ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Missing production Compose configuration" >&2; exit 1; }
  command -v docker >/dev/null || { echo "Docker is required for compose backup mode" >&2; exit 1; }
  DATABASE_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
elif [[ "$DB_ACCESS_MODE" == "direct" ]]; then
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required in direct mode}"
  DATABASE_NAME="${POSTGRES_DB:-marketplace}"
else
  echo "Unsupported DB_ACCESS_MODE=$DB_ACCESS_MODE (compose|direct)" >&2; exit 1
fi
[[ -n "$DATABASE_NAME" ]] || { echo "Database name is empty" >&2; exit 1; }
SAFE_DB_NAME="${DATABASE_NAME//[^a-zA-Z0-9_-]/_}"
BACKUP_FILE="$BACKUP_DIR/nexustheme_${SAFE_DB_NAME}_$(date -u +%Y%m%d_%H%M%S).sql.gz"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.nexustheme-backup-XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

echo "[INFO] Backing up database $DATABASE_NAME (mode=$DB_ACCESS_MODE)"
if [[ "$DB_ACCESS_MODE" == "compose" ]]; then
  compose exec -T postgres sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists' | gzip -6 > "$TEMP_FILE"
else
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" -d "$DATABASE_NAME" --no-owner --no-privileges --clean --if-exists | gzip -6 > "$TEMP_FILE"
fi
[[ -s "$TEMP_FILE" ]] && gzip -t "$TEMP_FILE" || { echo "[ERROR] Backup stream failed validation" >&2; exit 1; }
mv "$TEMP_FILE" "$BACKUP_FILE"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BACKUP_FILE" | awk '{print $1}' > "$BACKUP_FILE.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$BACKUP_FILE" | awk '{print $1}' > "$BACKUP_FILE.sha256"
else
  openssl dgst -sha256 "$BACKUP_FILE" | awk '{print $NF}' > "$BACKUP_FILE.sha256"
fi
echo "[OK] Local backup: $BACKUP_FILE"

if [[ -n "${BACKUP_R2_BUCKET:-}" ]]; then
  command -v aws >/dev/null || { echo "[ERROR] BACKUP_R2_BUCKET set but aws CLI is missing; offsite backup NOT completed" >&2; exit 1; }
  : "${STORAGE_ENDPOINT:?STORAGE_ENDPOINT required for R2 backup}"
  aws --endpoint-url "$STORAGE_ENDPOINT" s3 cp "$BACKUP_FILE" "s3://$BACKUP_R2_BUCKET/db-backups/"
  aws --endpoint-url "$STORAGE_ENDPOINT" s3 cp "$BACKUP_FILE.sha256" "s3://$BACKUP_R2_BUCKET/db-backups/"
  echo "[OK] Offsite backup copied to R2"
else
  echo "[WARNING] No offsite backup configured (set BACKUP_R2_BUCKET and AWS credentials)"
fi
find "$BACKUP_DIR" -maxdepth 1 -name "nexustheme_${SAFE_DB_NAME}_*.sql.gz*" -type f -mtime +30 -delete
