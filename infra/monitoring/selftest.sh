#!/usr/bin/env bash
# Proves the monitor: alerts once when something breaks, stays quiet while it stays broken,
# sends RESOLVED on recovery, and flags a stale backup heartbeat. Uses a local webhook sink.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "[MONITOR SELFTEST FAIL] $*" >&2; exit 1; }
SINK_PORT=18991; APP_PORT=18992

node -e '
const http=require("http"),fs=require("fs");
http.createServer((q,r)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{fs.appendFileSync(process.argv[1],b+"\n");r.end("ok")})}).listen(+process.argv[2]);
' "$WORK/alerts.log" $SINK_PORT & PIDS+=($!)
sleep 1

export ALERT_WEBHOOK_URL="http://127.0.0.1:$SINK_PORT/hook" MONITOR_STATE_DIR="$WORK/state" BACKUP_DIR="$WORK/backups" \
  MONITOR_URLS="app=http://127.0.0.1:$APP_PORT/health" DISK_PATHS="/" DISK_MAX_PERCENT=100 MONITOR_HOST_LABEL=selftest
mkdir -p "$BACKUP_DIR/drills"
now=$(date -u +%s)
echo "$now" > "$BACKUP_DIR/.last-success"; echo "$now" > "$BACKUP_DIR/.last-offsite-success"; echo "$now" > "$BACKUP_DIR/drills/.last-pass"

echo "== 1. app is down -> exactly one FIRING"
bash "$HERE/healthcheck.sh" && fail "healthcheck returned 0 with the app down"
bash "$HERE/healthcheck.sh" >/dev/null || true
[[ "$(grep -c 'FIRING' "$WORK/alerts.log")" == "1" ]] || fail "expected exactly 1 FIRING alert (dedupe)"

echo "== 2. app recovers -> RESOLVED"
node -e 'require("http").createServer((q,r)=>r.end("ok")).listen(+process.argv[1])' $APP_PORT & PIDS+=($!)
sleep 1
bash "$HERE/healthcheck.sh"
grep -q 'RESOLVED' "$WORK/alerts.log" || fail "no RESOLVED alert after recovery"

echo "== 3. stale backup heartbeat -> FIRING"
echo $(( now - 40*3600 )) > "$BACKUP_DIR/.last-success"
bash "$HERE/healthcheck.sh" && fail "stale backup was not detected"
grep -q 'backup.local' "$WORK/alerts.log" || fail "no alert for the stale backup"

echo "== 4. missing offsite heartbeat -> FIRING"
echo "$now" > "$BACKUP_DIR/.last-success"; rm "$BACKUP_DIR/.last-offsite-success"
bash "$HERE/healthcheck.sh" && fail "missing offsite backup was not detected"
grep -q 'backup.offsite' "$WORK/alerts.log" || fail "no alert for the missing offsite copy"
echo "[MONITOR SELFTEST PASS]"
