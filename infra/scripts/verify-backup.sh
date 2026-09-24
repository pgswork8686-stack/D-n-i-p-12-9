#!/usr/bin/env bash
# ==============================================================================
# NEXUSTHEME ENTERPRISE DISASTER RECOVERY — BACKUP INTEGRITY VERIFIER
# Verifies gzip integrity and SHA256 cryptographic signature
# Usage: ./infra/scripts/verify-backup.sh <PATH_TO_BACKUP_SQL_GZ>
# ==============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "[ERROR] Usage: $0 <path-to-nexustheme-backup.sql.gz>" >&2
  exit 1
fi

CHECKSUM_FILE="${BACKUP_FILE}.sha256"

echo "Checking ${BACKUP_FILE}..."

# Test gzip
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "[FAIL] Corrupt gzip archive: ${BACKUP_FILE}" >&2
  exit 2
fi

# Test SHA256 if present
if [ -f "${CHECKSUM_FILE}" ]; then
  EXPECTED=$(cat "${CHECKSUM_FILE}" | awk '{print $1}')
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')
  else
    ACTUAL=$(openssl dgst -sha256 "${BACKUP_FILE}" | awk '{print $NF}')
  fi

  if [ "${EXPECTED}" != "${ACTUAL}" ]; then
    echo "[FAIL] SHA256 mismatch for ${BACKUP_FILE} (Expected ${EXPECTED}, got ${ACTUAL})" >&2
    exit 3
  fi
fi

echo "[PASS] Backup integrity verified: ${BACKUP_FILE}"
exit 0
