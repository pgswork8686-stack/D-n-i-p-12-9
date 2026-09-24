#!/usr/bin/env bash
# ==============================================================================
# NEXUSTHEME ENTERPRISE DISASTER RECOVERY — POSTGRESQL RESTORE SCRIPT
# Target SLA: RTO < 30 minutes
# Usage: ./infra/scripts/restore-db.sh <PATH_TO_BACKUP_SQL_GZ> [--force]
# ==============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"
FORCE_FLAG="${2:-}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "[ERROR] Usage: $0 <path-to-nexustheme-backup.sql.gz> [--force]" >&2
  exit 1
fi

CHECKSUM_FILE="${BACKUP_FILE}.sha256"
DATABASE_NAME="${POSTGRES_DB:-marketplace}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

echo "================================================================================"
echo "   NEXUSTHEME COLD RESTORE PROCEDURE (DISASTER RECOVERY)"
echo "================================================================================"
echo "  Target Database : ${DATABASE_NAME} at ${DB_HOST}:${DB_PORT}"
echo "  Backup File     : ${BACKUP_FILE}"
echo "================================================================================"

# Step 1: Verify Checksum if present
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "[INFO] Verifying cryptographic SHA256 checksum..."
  EXPECTED_SUM=$(cat "${CHECKSUM_FILE}" | awk '{print $1}')
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SUM=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SUM=$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')
  else
    ACTUAL_SUM=$(openssl dgst -sha256 "${BACKUP_FILE}" | awk '{print $NF}')
  fi

  if [ "${EXPECTED_SUM}" != "${ACTUAL_SUM}" ]; then
    echo "[FATAL] Checksum verification failed!" >&2
    echo "  Expected: ${EXPECTED_SUM}" >&2
    echo "  Actual  : ${ACTUAL_SUM}" >&2
    exit 1
  fi
  echo "[SUCCESS] Cryptographic checksum verified (${ACTUAL_SUM})."
else
  echo "[WARN] No .sha256 checksum file found. Proceeding with caution."
fi

# Step 2: Validate gzip archive integrity
echo "[INFO] Validating gzip integrity of backup archive..."
gzip -t "${BACKUP_FILE}" || {
  echo "[FATAL] Backup file is corrupted or not a valid gzip stream." >&2
  exit 1
}
echo "[SUCCESS] Archive integrity verified."

# Step 3: Interactive or Force Confirmation
if [ "${FORCE_FLAG}" != "--force" ]; then
  read -r -p "WARNING: This will drop and overwrite database '${DATABASE_NAME}'. Continue? (yes/no): " CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    echo "[CANCELLED] Cold restore aborted by user."
    exit 0
  fi
fi

# Step 4: Perform Restoration
echo "[INFO] [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Executing psql database restoration..."

PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DATABASE_NAME}" \
  --single-transaction \
  --set ON_ERROR_STOP=on

# Step 5: Post-Restore Sanity Check
echo "[INFO] Verifying post-restore table count and connectivity..."
TABLE_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DATABASE_NAME}" \
  -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

echo "[SUCCESS] [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Cold restore completed successfully!"
echo "  Public Tables Restored: ${TABLE_COUNT// /}"
