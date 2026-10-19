#!/usr/bin/env bash
# Sends one alert to every configured channel. Usage: alert.sh <FIRING|RESOLVED|INFO> <title> <message>
#   ALERT_WEBHOOK_URL            generic JSON webhook ({"text": "..."}): Slack, Mattermost, n8n, Discord via proxy
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   Telegram bot
# Prints a line to stderr even when no channel is configured so a missing channel is never silent.
set -uo pipefail
STATE="${1:-INFO}"; TITLE="${2:-alert}"; MSG="${3:-}"
HOST="${MONITOR_HOST_LABEL:-$(hostname)}"
case "$STATE" in FIRING) ICON="🔴";; RESOLVED) ICON="🟢";; *) ICON="ℹ️";; esac
TEXT="$ICON [$STATE] $TITLE ($HOST)"$'\n'"$MSG"

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/}
  printf '%s' "$s"
}

SENT=0
if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
  if curl -fsS -m 10 -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$(json_escape "$TEXT")\"}" "$ALERT_WEBHOOK_URL" >/dev/null; then SENT=1; else echo "[alert] webhook delivery FAILED" >&2; fi
fi
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  if curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${TEXT}" >/dev/null; then SENT=1; else echo "[alert] telegram delivery FAILED" >&2; fi
fi
[[ $SENT -eq 1 ]] || echo "[alert] NO CHANNEL DELIVERED: $TEXT" >&2
exit 0
