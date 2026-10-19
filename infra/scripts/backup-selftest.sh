#!/usr/bin/env bash
# End-to-end self-test of backup -> encrypt -> authenticate -> offsite copy -> restore drill on SYNTHETIC data.
# Never touches real data. Proves the failure paths too: every kind of tampering, a wrong key, a missing manifest,
# a plaintext offsite archive and the removed "allow unencrypted offsite" override must all be rejected.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/infra/scripts/backup-lib.sh"
WORK="$(mktemp -d)"
SRC="nexus-backup-selftest-src-$$"
cleanup() { docker rm -f "$SRC" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "[SELFTEST FAIL] $*" >&2; exit 1; }
drill() { # <offsite-dir> <key-file> [report-dir]  -> returns the drill's exit status
  BACKUP_ENCRYPTION_KEY_FILE="$2" DRILL_REPORT_DIR="${3:-$WORK/drills-x}" bash "$ROOT/infra/scripts/restore-drill.sh" "$1" >/dev/null 2>&1
}
must_fail() { local what="$1"; shift; if "$@"; then fail "$what was ACCEPTED but must be rejected"; else echo "   ok: $what rejected"; fi; }

openssl rand -base64 48 > "$WORK/backup.key"
openssl rand -base64 48 > "$WORK/wrong.key"

docker run -d --name "$SRC" -e POSTGRES_PASSWORD=selftest -e POSTGRES_USER=app -e POSTGRES_DB=marketplace postgres:16-alpine >/dev/null
for _ in $(seq 1 90); do docker exec "$SRC" pg_isready -h 127.0.0.1 -U app -d marketplace >/dev/null 2>&1 && break; sleep 1; done
docker exec -i "$SRC" psql -U app -d marketplace -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE customers (id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text, created_at timestamptz DEFAULT now());
CREATE TABLE orders (id serial PRIMARY KEY, customer_id int REFERENCES customers(id), total numeric(12,2), note text);
INSERT INTO customers (email, name) SELECT 'khach' || g || '@example.test', 'Khách hàng số ' || g || ' — Nguyễn Văn Ạ' FROM generate_series(1, 250) g;
INSERT INTO orders (customer_id, total, note) SELECT (g % 250) + 1, g * 1.5, E'dòng 1\nđơn ''thử'' "nghiệm" ' || g FROM generate_series(1, 1200) g;
SQL

OFFSITE="$WORK/offsite"; LOCAL="$WORK/local"
DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" BACKUP_OFFSITE_DIR="$OFFSITE" \
  bash "$ROOT/infra/scripts/backup-db.sh" "$LOCAL"

echo "== what is on disk and what left the host"
ls "$LOCAL"/*.sql.gz >/dev/null 2>&1 && fail "plaintext dump left on the server"
ls "$LOCAL"/*.manifest.tsv >/dev/null 2>&1 && fail "plaintext manifest left on the server"
ls "$OFFSITE"/*.sql.gz >/dev/null 2>&1 && fail "plaintext dump reached the offsite copy"
ls "$OFFSITE"/*.manifest.tsv >/dev/null 2>&1 && fail "plaintext manifest reached the offsite copy"
ENC="$(ls "$OFFSITE"/*.sql.gz.enc)"
[[ -f "$ENC.manifest.enc" && -f "$ENC.hmac" && -f "$ENC.sha256" ]] || fail "offsite set is incomplete (need .enc, .manifest.enc, .hmac, .sha256)"
gzip -t "$ENC" 2>/dev/null && fail "offsite dump is readable as gzip, so it is not encrypted"
grep -aq "customers" "$ENC" && fail "table names visible inside the encrypted dump"
grep -aq "customers" "$ENC.manifest.enc" && fail "table names visible inside the encrypted manifest"
[[ -f "$LOCAL/.last-success" && -f "$LOCAL/.last-offsite-success" ]] || fail "heartbeat files missing"

echo "== happy path"
BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" DRILL_REPORT_DIR="$WORK/drills" bash "$ROOT/infra/scripts/restore-drill.sh" "$OFFSITE"
grep -q '"status":"PASS"' "$WORK"/drills/drill_*.json || fail "drill did not pass"
BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" bash "$ROOT/infra/scripts/verify-backup.sh" "$ENC" >/dev/null || fail "verify-backup rejected a good backup"

echo "== every alteration must be rejected"
must_fail "wrong key" drill "$OFFSITE" "$WORK/wrong.key"
cp -r "$OFFSITE" "$WORK/o_tamper"; E2="$WORK/o_tamper/$(basename "$ENC")"
printf 'X' | dd of="$E2" bs=1 seek=100 conv=notrunc 2>/dev/null
must_fail "tampered dump" drill "$WORK/o_tamper" "$WORK/backup.key"

rm -rf "$WORK/o_man"; cp -r "$OFFSITE" "$WORK/o_man"; M2="$WORK/o_man/$(basename "$ENC").manifest.enc"
printf 'X' | dd of="$M2" bs=1 seek=40 conv=notrunc 2>/dev/null
must_fail "tampered manifest" drill "$WORK/o_man" "$WORK/backup.key"

rm -rf "$WORK/o_nomani"; cp -r "$OFFSITE" "$WORK/o_nomani"; rm "$WORK/o_nomani/$(basename "$ENC").manifest.enc"
must_fail "missing manifest" drill "$WORK/o_nomani" "$WORK/backup.key"

rm -rf "$WORK/o_nohmac"; cp -r "$OFFSITE" "$WORK/o_nohmac"; rm "$WORK/o_nohmac/$(basename "$ENC").hmac"
must_fail "missing authentication tag" drill "$WORK/o_nohmac" "$WORK/backup.key"

# An attacker with write access but no key swaps in a dump encrypted under THEIR key and fixes the checksum.
rm -rf "$WORK/o_swap"; cp -r "$OFFSITE" "$WORK/o_swap"; E3="$WORK/o_swap/$(basename "$ENC")"
docker exec "$SRC" sh -c 'pg_dump -U app -d marketplace --clean --if-exists' | gzip > "$WORK/evil.sql.gz"
encrypt_file "$WORK/evil.sql.gz" "$E3" "$WORK/wrong.key"
echo "$(sha256_of "$E3")" > "$E3.sha256"
must_fail "swapped dump with a recomputed checksum" drill "$WORK/o_swap" "$WORK/backup.key"

# A plaintext archive appearing in the offsite location.
rm -rf "$WORK/o_plain"; mkdir "$WORK/o_plain"; cp "$WORK/evil.sql.gz" "$WORK/o_plain/nexustheme_marketplace_20260101_000000.sql.gz"
must_fail "plaintext archive in offsite" drill "$WORK/o_plain" "$WORK/backup.key"

echo "== no way to ship plaintext"
must_fail "offsite without a key" env DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_OFFSITE_DIR="$WORK/o2" bash "$ROOT/infra/scripts/backup-db.sh" "$WORK/l2"
must_fail "offsite without a key even with the old override variable" env BACKUP_ALLOW_UNENCRYPTED_OFFSITE=true DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_OFFSITE_DIR="$WORK/o3" bash "$ROOT/infra/scripts/backup-db.sh" "$WORK/l3"
must_fail "plaintext kept together with an offsite target" env BACKUP_KEEP_PLAINTEXT=true BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_OFFSITE_DIR="$WORK/o4" bash "$ROOT/infra/scripts/backup-db.sh" "$WORK/l4"
[[ ! -e "$WORK/o2" && ! -e "$WORK/o3" && ! -e "$WORK/o4" ]] || fail "a refused backup still created an offsite directory"

echo "== restore-db.sh refuses what the drill refuses"
must_fail "restore of a tampered backup" env DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" bash "$ROOT/infra/scripts/restore-db.sh" "$E2" --force
echo "== restore-db.sh accepts the authentic backup (restores into the synthetic source and keeps the data)"
docker exec "$SRC" psql -U app -d marketplace -q -c "DELETE FROM orders; DELETE FROM customers;"
DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" bash "$ROOT/infra/scripts/restore-db.sh" "$ENC" --force >/dev/null
[[ "$(docker exec "$SRC" psql -U app -d marketplace -tAc "select count(*) from orders")" == "1200" ]] || fail "restore-db.sh did not bring the data back"
echo "[SELFTEST PASS] encryption, authentication, offsite copy, restore proof and every rejection path behave"
