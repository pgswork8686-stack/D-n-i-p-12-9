#!/usr/bin/env bash
# Shared helpers for backup-db.sh, restore-db.sh and restore-drill.sh (sourced, not executed).
# Encryption: AES-256-CBC + PBKDF2 (openssl enc). It does not authenticate by itself, so every encrypted
# backup also carries an HMAC-SHA256 tag (.hmac) made with a SEPARATE key derived from the key file. The tag
# covers the ciphertext hash AND the encrypted manifest hash, so anyone without the key cannot swap, truncate
# or replace the dump, the manifest or the checksum files without being detected before anything is decrypted.

native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf %s "$1"; fi; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else openssl dgst -sha256 "$1" | awk '{print $NF}'; fi
}

# Encrypts $1 -> $2 with the key file $3.
encrypt_file() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$(native_path "$1")" -out "$(native_path "$2")" -pass "file:$(native_path "$3")"
}
# Decrypts $1 to stdout with the key file $2.
decrypt_stream() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$(native_path "$1")" -pass "file:$(native_path "$2")"
}

# MAC key = SHA-256("nexus-backup-mac-v1" || key file bytes); never the encryption key itself.
mac_key() { { printf 'nexus-backup-mac-v1'; cat "$1"; } | openssl dgst -sha256 | awk '{print $NF}'; }

# mac_tag <enc-file> <manifest-enc-file> <key-file>
mac_tag() {
  local enc="$1" man="$2" key="$3"
  printf 'v1\n%s\n%s\n%s\n' "$(basename "$enc")" "$(sha256_of "$enc")" "$(sha256_of "$man")" \
    | openssl dgst -sha256 -hmac "$(mac_key "$key")" | awk '{print $NF}'
}

# verify_backup_mac <enc-file> <key-file>: exits non-zero (and prints why) unless every companion file is present and authentic.
verify_backup_mac() {
  local enc="$1" key="$2" man="$1.manifest.enc" tag="$1.hmac"
  [[ -s "$key" ]] || { echo "[FAIL] Encryption key file missing" >&2; return 4; }
  [[ -f "$tag" ]] || { echo "[FAIL] Missing authentication tag ($(basename "$tag")); refusing an unauthenticated backup" >&2; return 3; }
  [[ -f "$man" ]] || { echo "[FAIL] Missing encrypted manifest ($(basename "$man")); refusing" >&2; return 3; }
  [[ "$(mac_tag "$enc" "$man" "$key")" == "$(tr -d '[:space:]' < "$tag")" ]] || { echo "[FAIL] Authentication tag mismatch: the backup, manifest or checksum was altered or the key is wrong" >&2; return 3; }
  if [[ -f "$enc.sha256" ]]; then
    [[ "$(sha256_of "$enc")" == "$(awk '{print $1}' "$enc.sha256")" ]] || { echo "[FAIL] Checksum mismatch" >&2; return 3; }
  fi
  return 0
}