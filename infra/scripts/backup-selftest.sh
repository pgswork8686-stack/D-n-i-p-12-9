#!/usr/bin/env bash
# End-to-end self-test of backup → encrypt → offsite copy → restore drill on SYNTHETIC data.
# Spins up a throwaway source database, never touches real data. Also proves the failure paths:
# a tampered offsite copy and a wrong key must be rejected.
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
SRC="nexus-backup-selftest-src-$$"
cleanup() { docker rm -f "$SRC" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "[SELFTEST FAIL] $*" >&2; exit 1; }

openssl rand -base64 48 > "$WORK/backup.key"
openssl rand -base64 48 > "$WORK/wrong.key"

docker run -d --name "$SRC" -e POSTGRES_PASSWORD=selftest -e POSTGRES_USER=app -e POSTGRES_DB=marketplace postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$SRC" pg_isready -U app -d marketplace >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$SRC" psql -U app -d marketplace -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE customers (id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text, created_at timestamptz DEFAULT now());
CREATE TABLE orders (id serial PRIMARY KEY, customer_id int REFERENCES customers(id), total numeric(12,2), note text);
INSERT INTO customers (email, name) SELECT 'khach' || g || '@example.test', 'Khách hàng số ' || g || ' — Nguyễn Văn Ạ' FROM generate_series(1, 250) g;
INSERT INTO orders (customer_id, total, note) SELECT (g % 250) + 1, g * 1.5, E'dòng 1\nđơn ''thử'' "nghiệm" ' || g FROM generate_series(1, 1200) g;
SQL

OFFSITE="$WORK/offsite"; LOCAL="$WORK/local"
DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" BACKUP_OFFSITE_DIR="$OFFSITE" \
  bash "$ROOT/infra/scripts/backup-db.sh" "$LOCAL"

ls "$LOCAL"/*.sql.gz >/dev/null 2>&1 && fail "plaintext dump left on the server"
ls "$OFFSITE"/*.sql.gz >/dev/null 2>&1 && fail "plaintext dump reached the offsite copy"
ENC="$(ls "$OFFSITE"/*.sql.gz.enc)"
gzip -t "$ENC" 2>/dev/null && fail "offsite file is readable as gzip, so it is not encrypted"
grep -aq "customers" "$ENC" && fail "table names visible inside the encrypted file"
[[ -f "$LOCAL/.last-success" && -f "$LOCAL/.last-offsite-success" ]] || fail "heartbeat files missing"

echo "== drill (happy path)"
BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" DRILL_REPORT_DIR="$WORK/drills" bash "$ROOT/infra/scripts/restore-drill.sh" "$OFFSITE"
grep -q '"status":"PASS"' "$WORK"/drills/drill_*.json || fail "drill did not pass"

echo "== drill (wrong key must fail)"
if BACKUP_ENCRYPTION_KEY_FILE="$WORK/wrong.key" DRILL_REPORT_DIR="$WORK/drills2" bash "$ROOT/infra/scripts/restore-drill.sh" "$OFFSITE" >/dev/null 2>&1; then
  fail "drill passed with the wrong key"
fi

echo "== drill (tampered offsite copy must fail)"
cp "$ENC" "$ENC.bak"; printf 'X' | dd of="$ENC" bs=1 seek=100 conv=notrunc 2>/dev/null
if BACKUP_ENCRYPTION_KEY_FILE="$WORK/backup.key" DRILL_REPORT_DIR="$WORK/drills3" bash "$ROOT/infra/scripts/restore-drill.sh" "$OFFSITE" >/dev/null 2>&1; then
  fail "drill passed on a tampered file"
fi
mv "$ENC.bak" "$ENC"

echo "== unencrypted offsite must be refused"
if DB_ACCESS_MODE=container DB_CONTAINER="$SRC" BACKUP_OFFSITE_DIR="$WORK/o2" bash "$ROOT/infra/scripts/backup-db.sh" "$WORK/l2" >/dev/null 2>&1; then
  fail "plaintext offsite was allowed"
fi
echo "[SELFTEST PASS] backup, encryption, offsite copy, restore drill and failure paths all behave"
