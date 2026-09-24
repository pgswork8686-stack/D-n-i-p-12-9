#!/usr/bin/env bash
# ==============================================================================
# NEXUSTHEME ENTERPRISE DISASTER RECOVERY — POSTGRESQL BACKUP SCRIPT
# Target SLA: RPO < 15 minutes, RTO < 30 minutes
# Usage: ./infra/scripts/backup-db.sh [BACKUP_DIR]
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
DATABASE_NAME="${POSTGRES_DB:-marketplace}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

BACKUP_FILE="${BACKUP_DIR}/nexustheme_${DATABASE_NAME}_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

mkdir -p "${BACKUP_DIR}"

echo "[INFO] [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting database backup for '${DATABASE_NAME}' at ${DB_HOST}:${DB_PORT}..."

# Execute pg_dump with custom/clean schema and gzip compression
PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DATABASE_NAME}" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip -9 > "${BACKUP_FILE}"

# Verify backup file was created and is non-empty
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[ERROR] Backup failed: backup file '${BACKUP_FILE}' is empty or does not exist." >&2
  exit 1
fi

# Generate SHA256 checksum for cryptographic integrity verification
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${BACKUP_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
else
  openssl dgst -sha256 "${BACKUP_FILE}" | awk '{print $NF}' > "${CHECKSUM_FILE}"
fi

BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || wc -c < "${BACKUP_FILE}")
CHECKSUM=$(cat "${CHECKSUM_FILE}")

echo "[SUCCESS] [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed successfully!"
echo "  File    : ${BACKUP_FILE}"
echo "  Size    : ${BACKUP_SIZE} bytes"
echo "  SHA256  : ${CHECKSUM}"

# Optional: Upload to offsite S3/R2 disaster recovery bucket if configured
if [ -n "${BACKUP_R2_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  echo "[INFO] Uploading backup to Cloudflare R2 bucket '${BACKUP_R2_BUCKET}'..."
  aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_R2_BUCKET}/db-backups/" --endpoint-url "${STORAGE_ENDPOINT:-https://r2.cloudflarestorage.com}"
  aws s3 cp "${CHECKSUM_FILE}" "s3://${BACKUP_R2_BUCKET}/db-backups/" --endpoint-url "${STORAGE_ENDPOINT:-https://r2.cloudflarestorage.com}"
  echo "[SUCCESS] Offsite replica stored in R2 bucket '${BACKUP_R2_BUCKET}'."
fi

# Retention policy: Prune backups older than 30 days locally
find "${BACKUP_DIR}" -name "nexustheme_${DATABASE_NAME}_*.sql.gz*" -type f -mtime +30 -delete 2>/dev/null || true
echo "[INFO] Backup retention cleanup completed (kept <= 30 days)."
