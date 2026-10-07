#!/usr/bin/env bash
# Runs the full acceptance suite the same way CI does (Linux).
#   infra/scripts/run-acceptance.sh            # phases 4..18
#   infra/scripts/run-acceptance.sh 13 14      # selected phases
# Requires Postgres/Redis/MinIO reachable via DATABASE_URL/REDIS_URL/STORAGE_*.
set -uo pipefail

cd "$(dirname "$0")/../.."
PHASES=("$@")
if [ ${#PHASES[@]} -eq 0 ]; then PHASES=($(seq 4 18)); fi

pnpm --filter @nexus/api run build >/dev/null
pnpm --filter @nexus/worker run build >/dev/null
pnpm --filter @nexus/portal run build >/dev/null   # Phase 10 inspects the portal route manifest

failed=()
for n in "${PHASES[@]}"; do
  log="/tmp/acceptance-phase$n.log"
  start=$(date +%s)
  if pnpm "test:acceptance:phase$n" >"$log" 2>&1; then
    echo "phase$n PASS ($(( $(date +%s) - start ))s)"
  else
    echo "phase$n FAIL ($(( $(date +%s) - start ))s) — last lines:"
    tail -n 15 "$log" | sed 's/^/    /'
    failed+=("$n")
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED PHASES: ${failed[*]}"
  exit 1
fi
echo "ALL ACCEPTANCE PHASES PASSED"
