#!/usr/bin/env bash
# Backup integrity verifier.
# Usage: ./infra/scripts/verify-backup.sh <backup.sql.gz.enc | backup.sql.gz>
#   Encrypted: needs BACKUP_ENCRYPTION_KEY_FILE; checks the HMAC tag, the encrypted manifest and the checksum.
#   Plaintext (dev only): checks gzip integrity and the SHA-256 file, which must exist.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
BACKUP_FILE="${1:-}"
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo "[ERROR] Usage: $0 <path-to-backup>" >&2; exit 1; }

if [[ "$BACKUP_FILE" == *.enc ]]; then
  verify_backup_mac "$BACKUP_FILE" "${BACKUP_ENCRYPTION_KEY_FILE:-}" || exit 3
  decrypt_stream "$BACKUP_FILE" "$BACKUP_ENCRYPTION_KEY_FILE" | gzip -t || { echo "[FAIL] Dump does not decrypt to valid gzip" >&2; exit 2; }
else
  gzip -t "$BACKUP_FILE" 2>/dev/null || { echo "[FAIL] Corrupt gzip archive: $BACKUP_FILE" >&2; exit 2; }
  [[ -f "$BACKUP_FILE.sha256" ]] || { echo "[FAIL] Missing checksum file" >&2; exit 3; }
  [[ "$(sha256_of "$BACKUP_FILE")" == "$(awk '{print $1}' "$BACKUP_FILE.sha256")" ]] || { echo "[FAIL] SHA256 mismatch" >&2; exit 3; }
fi
echo "[PASS] Backup integrity verified: $BACKUP_FILE"