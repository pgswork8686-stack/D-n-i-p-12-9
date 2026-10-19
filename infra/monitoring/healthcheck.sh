#!/usr/bin/env bash
# Runs all checks, alerts only on state changes (plus a reminder while still failing), exits 1 if any check fails.
#
#   MONITOR_URLS        "api=http://127.0.0.1:4000/health/readiness,web=https://example.com,portal=...,admin=..."
#   MONITOR_EXPECT      HTTP status that counts as healthy (default 200)
#   BACKUP_DIR          dir holding .last-success / .last-offsite-success (default ./backups)
#   BACKUP_MAX_AGE_HOURS (default 26)    DRILL_MAX_AGE_DAYS (default 35, checks $BACKUP_DIR/drills/.last-pass)
#   DISK_PATHS          "/,/var/lib/docker" and DISK_MAX_PERCENT (default 85)
#   TLS_HOSTS           "example.com,portal.example.com" and TLS_MIN_DAYS (default 14)
#   MONITOR_STATE_DIR   where alert state lives (default /var/tmp/nexus-monitor)
#   REMIND_MINUTES      re-alert interval while failing (default 360)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${MONITOR_STATE_DIR:-/var/tmp/nexus-monitor}"; mkdir -p "$STATE_DIR"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
EXPECT="${MONITOR_EXPECT:-200}"
NOW="$(date -u +%s)"
FAILED=0

# report <check-id> <ok|fail> <detail>
report() {
  local id="$1" status="$2" detail="$3" f="$STATE_DIR/${1//[^a-zA-Z0-9_.-]/_}.state" prev="" since=0 last=0
  [[ -f "$f" ]] && read -r prev since last < "$f"
  if [[ "$status" == "fail" ]]; then
    FAILED=1
    if [[ "$prev" != "fail" ]]; then
      bash "$HERE/alert.sh" FIRING "$id" "$detail"; echo "fail $NOW $NOW" > "$f"
    elif (( NOW - last >= ${REMIND_MINUTES:-360} * 60 )); then
      bash "$HERE/alert.sh" FIRING "$id (still failing since $(date -u -d "@$since" +%FT%TZ 2>/dev/null || echo "$since"))" "$detail"; echo "fail $since $NOW" > "$f"
    fi
    echo "FAIL  $id — $detail"
  else
    if [[ "$prev" == "fail" ]]; then bash "$HERE/alert.sh" RESOLVED "$id" "$detail"; fi
    echo "ok    $id — $detail"; echo "ok $NOW $NOW" > "$f"
  fi
}

IFS=',' read -r -a URLS <<< "${MONITOR_URLS:-}"
for entry in "${URLS[@]:-}"; do
  [[ -n "$entry" ]] || continue
  name="${entry%%=*}"; url="${entry#*=}"
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" || true)"
  if [[ "$code" == "$EXPECT" ]]; then report "http:$name" ok "$url -> $code"; else report "http:$name" fail "$url -> ${code:-no response} (expected $EXPECT)"; fi
done

age_check() { # id file max_seconds label
  local id="$1" file="$2" max="$3" label="$4"
  if [[ ! -f "$file" ]]; then report "$id" fail "$label: no heartbeat file at $file (never succeeded?)"; return; fi
  local ts; ts="$(cat "$file")"; local age=$(( NOW - ts ))
  if (( age > max )); then report "$id" fail "$label: last success $((age/3600))h ago (limit $((max/3600))h)"; else report "$id" ok "$label: last success $((age/60)) min ago"; fi
}
if [[ -n "${CHECK_BACKUP:-true}" && "${CHECK_BACKUP:-true}" != "false" ]]; then
  age_check backup.local "$BACKUP_DIR/.last-success" $(( ${BACKUP_MAX_AGE_HOURS:-26} * 3600 )) "Database backup"
  age_check backup.offsite "$BACKUP_DIR/.last-offsite-success" $(( ${BACKUP_MAX_AGE_HOURS:-26} * 3600 )) "Offsite backup copy"
  age_check backup.drill "$BACKUP_DIR/drills/.last-pass" $(( ${DRILL_MAX_AGE_DAYS:-35} * 86400 )) "Restore drill"
fi

IFS=',' read -r -a DISKS <<< "${DISK_PATHS:-/}"
for p in "${DISKS[@]}"; do
  [[ -d "$p" ]] || continue
  used="$(df -P "$p" 2>/dev/null | awk 'NR==2{gsub("%","",$(NF-1)); print $(NF-1)}')"
  [[ "$used" =~ ^[0-9]+$ ]] || { report "disk:$p" fail "cannot read disk usage for $p"; continue; }
  if (( used >= ${DISK_MAX_PERCENT:-85} )); then report "disk:$p" fail "$p is ${used}% full (limit ${DISK_MAX_PERCENT:-85}%)"; else report "disk:$p" ok "$p ${used}% used"; fi
done

IFS=',' read -r -a HOSTS <<< "${TLS_HOSTS:-}"
for h in "${HOSTS[@]:-}"; do
  [[ -n "$h" ]] || continue
  end="$(echo | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -z "$end" ]]; then report "tls:$h" fail "cannot read certificate from $h:443"; continue; fi
  days=$(( ( $(date -u -d "$end" +%s) - NOW ) / 86400 ))
  if (( days < ${TLS_MIN_DAYS:-14} )); then report "tls:$h" fail "certificate expires in ${days} days"; else report "tls:$h" ok "certificate valid for ${days} more days"; fi
done

exit $FAILED
