#!/usr/bin/env bash
# Restore PostgreSQL from a backup produced by backup-db.sh. WARNING: overwrites the selected database.
# Stop the API and worker first.
#
# Usage: restore-db.sh <backup.sql.gz.enc | backup.sql.gz> [--force]
#   Encrypted archives need BACKUP_ENCRYPTION_KEY_FILE and are verified (HMAC over dump + manifest + checksum)
#   BEFORE anything is decrypted or executed. A missing/invalid tag, manifest or checksum aborts the restore.
#   Plain .sql.gz is only accepted for local/dev databases (DB_ACCESS_MODE=container|direct) and needs its checksum.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=backup-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
BACKUP_FILE="${1:-}"
FORCE="${2:-}"
DB_ACCESS_MODE="${DB_ACCESS_MODE:-compose}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/production-compose.yml}"
[[ -f "$BACKUP_FILE" ]] || { echo "Usage: $0 backup.sql.gz.enc|backup.sql.gz [--force]" >&2; exit 1; }
[[ "$FORCE" == "" || "$FORCE" == "--force" ]] || { echo "Unknown option: $FORCE" >&2; exit 1; }

compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
case "$DB_ACCESS_MODE" in
  compose)
    [[ -f "$COMPOSE_ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Missing production Compose configuration" >&2; exit 1; }
    command -v docker >/dev/null || { echo "Docker required" >&2; exit 1; }
    DATABASE_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')" ;;
  container)
    : "${DB_CONTAINER:?DB_CONTAINER required in container mode}"
    DATABASE_NAME="$(docker exec "$DB_CONTAINER" printenv POSTGRES_DB | tr -d '\r')" ;;
  direct)
    : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required in direct mode}"
    DATABASE_NAME="${POSTGRES_DB:-marketplace}" ;;
  *) echo "Unknown DB_ACCESS_MODE=$DB_ACCESS_MODE" >&2; exit 1 ;;
esac
[[ -n "$DATABASE_NAME" ]] || { echo "Database name is empty" >&2; exit 1; }

if [[ "$BACKUP_FILE" == *.enc ]]; then
  verify_backup_mac "$BACKUP_FILE" "${BACKUP_ENCRYPTION_KEY_FILE:-}" || exit 3
  backup_stream() { decrypt_stream "$BACKUP_FILE" "$BACKUP_ENCRYPTION_KEY_FILE"; }
else
  # Plaintext archives never belong in production: only dev/test databases may take them.
  [[ "$DB_ACCESS_MODE" == "compose" ]] && { echo "Refusing to restore a plaintext archive into the production compose database" >&2; exit 3; }
  [[ -f "$BACKUP_FILE.sha256" ]] || { echo "Missing $BACKUP_FILE.sha256; refusing" >&2; exit 3; }
  [[ "$(sha256_of "$BACKUP_FILE")" == "$(awk '{print $1}' "$BACKUP_FILE.sha256")" ]] || { echo "Backup checksum mismatch; refusing restore" >&2; exit 3; }
  backup_stream() { cat "$BACKUP_FILE"; }
fi
backup_stream | gzip -t || { echo "Invalid gzip backup (or wrong decryption key)" >&2; exit 1; }

echo "[WARNING] Target database: $DATABASE_NAME (mode=$DB_ACCESS_MODE)"
echo "[WARNING] Stop the API and worker containers before restoring."
if [[ "$FORCE" != "--force" ]]; then
  read -r -p "Type yes to OVERWRITE this database: " CONFIRM
  [[ "$CONFIRM" == "yes" ]] || { echo "Restore cancelled"; exit 1; }
fi
PSQL_IN='export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on'
case "$DB_ACCESS_MODE" in
  compose)
    backup_stream | gzip -dc | compose exec -T postgres sh -ec "$PSQL_IN"
    compose exec -T postgres sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='\''public'\'';"' ;;
  container)
    backup_stream | gzip -dc | docker exec -i "$DB_CONTAINER" sh -ec "$PSQL_IN" ;;
  direct)
    backup_stream | gzip -dc | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" -d "$DATABASE_NAME" --single-transaction --set ON_ERROR_STOP=on ;;
esac
echo "[OK] Restore finished; verify application readiness before reopening traffic."