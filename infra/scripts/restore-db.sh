#!/usr/bin/env bash
# Restore production PostgreSQL through Docker (no host DB port required).
# WARNING: overwrites the selected database. Stop API and worker first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_FILE="${1:-}"
FORCE="${2:-}"
DB_ACCESS_MODE="${DB_ACCESS_MODE:-compose}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/production-compose.yml}"
[[ -f "$BACKUP_FILE" ]] || { echo "Usage: $0 backup.sql.gz [--force]" >&2; exit 1; }
[[ "$FORCE" == "" || "$FORCE" == "--force" ]] || { echo "Unknown option: $FORCE" >&2; exit 1; }

compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
if [[ "$DB_ACCESS_MODE" == "compose" ]]; then
  [[ -f "$COMPOSE_ENV_FILE" && -f "$COMPOSE_FILE" ]] || { echo "Missing production Compose configuration" >&2; exit 1; }
  command -v docker >/dev/null || { echo "Docker required" >&2; exit 1; }
  DATABASE_NAME="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
elif [[ "$DB_ACCESS_MODE" == "direct" ]]; then
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required in direct mode}"
  DATABASE_NAME="${POSTGRES_DB:-marketplace}"
else
  echo "Unknown DB_ACCESS_MODE=$DB_ACCESS_MODE" >&2; exit 1
fi
[[ -n "$DATABASE_NAME" ]] || { echo "Database name is empty" >&2; exit 1; }

# Require checksum for container/production restores. Direct mode permits old archives.
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  EXPECTED="$(awk '{print $1}' "$BACKUP_FILE.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
  else
    ACTUAL="$(openssl dgst -sha256 "$BACKUP_FILE" | awk '{print $NF}')"
  fi
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "Backup checksum mismatch; refusing restore" >&2; exit 1; }
elif [[ "$DB_ACCESS_MODE" == "compose" ]]; then
  echo "Missing $BACKUP_FILE.sha256; refusing production restore" >&2; exit 1
fi
gzip -t "$BACKUP_FILE" || { echo "Invalid gzip backup" >&2; exit 1; }

echo "[WARNING] Target database: $DATABASE_NAME (mode=$DB_ACCESS_MODE)"
echo "[WARNING] Stop the API and worker containers before restoring."
if [[ "$FORCE" != "--force" ]]; then
  read -r -p "Type yes to OVERWRITE this database: " CONFIRM
  [[ "$CONFIRM" == "yes" ]] || { echo "Restore cancelled"; exit 1; }
fi
if [[ "$DB_ACCESS_MODE" == "compose" ]]; then
  gzip -dc "$BACKUP_FILE" | compose exec -T postgres sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on'
  compose exec -T postgres sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='\''public'\'';"'
else
  gzip -dc "$BACKUP_FILE" | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" -d "$DATABASE_NAME" --single-transaction --set ON_ERROR_STOP=on
fi
echo "[OK] Restore finished; verify application readiness before reopening traffic."
