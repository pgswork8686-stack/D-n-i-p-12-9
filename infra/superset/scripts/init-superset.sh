#!/bin/sh
# Phase 19 — one-shot Superset bootstrap (runs in the superset-init container).
set -eu

case "$ANALYTICS_DATABASE_URI" in
  *superset_ro*) ;;
  *) echo "ANALYTICS_DATABASE_URI must use the read-only superset_ro role; refusing to continue" >&2; exit 1 ;;
esac

superset db upgrade
superset fab create-admin \
  --username "$SUPERSET_ADMIN_USERNAME" \
  --firstname Admin --lastname NexusTheme \
  --email "$SUPERSET_ADMIN_EMAIL" \
  --password "$SUPERSET_ADMIN_PASSWORD" || true   # already exists on re-runs
superset init
# Register the warehouse connection (credentials stay inside Superset's encrypted metadata DB).
superset set_database_uri --database_name "NexusTheme Analytics" --uri "$ANALYTICS_DATABASE_URI"
echo "Superset initialised. Configure RLS rules per client before granting dashboard access (see infra/superset/README.md)."
