#!/usr/bin/env bash
# Full verification of one commit; writes a step log (timestamp, command, exit code) for QA evidence.
# Usage: REPO_DIR=<repo> ENV_FILE=<env with DATABASE_URL, REDIS_URL, STORAGE_*> QA_WORKDIR=<output dir> bash verify-all.sh
# Expects Postgres container "pgs-test-postgres" (port 55432) and Redis "pgs-test-redis"; adjust db_reset for your setup.
S="${QA_WORKDIR:-$PWD/.qa-run}"
OUT="$S/qa"
mkdir -p "$OUT"
LOG="$OUT/steps.tsv"
cd "${REPO_DIR:-.}" || exit 1
set -a; . "${ENV_FILE:-$S/test.env}"; set +a

SHA=$(git rev-parse HEAD)
printf "sha\t%s\nnode\t%s\npnpm\t%s\ndocker\t%s\nstarted\t%s\n" "$SHA" "$(node -v)" "$(pnpm -v)" "$(docker version --format '{{.Server.Version}}')" "$(date -u +%FT%TZ)" > "$OUT/env.tsv"
printf "step\tcommand\texit\tstarted_utc\tseconds\tlog\n" > "$LOG"

run() {
  local name="$1"; shift
  local cmd="$*"
  local start=$(date -u +%FT%TZ); local t0=$(date +%s)
  bash -c "$cmd" > "$OUT/$name.log" 2>&1
  local code=$?
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$name" "$cmd" "$code" "$start" "$(( $(date +%s) - t0 ))" "$name.log" >> "$LOG"
}

[ -z "$(git status --porcelain)" ] || echo "WARNING: dirty tree" >> "$OUT/env.tsv"

run install "pnpm install --frozen-lockfile"
run db_generate "pnpm db:generate"
run lint "pnpm lint"
run typecheck "pnpm typecheck"
run unit_tests "pnpm test"
run prisma_validate "cd packages/database && node scripts/prisma-cli.js validate"
run db_reset "docker exec pgs-test-postgres psql -U postgres -c 'DROP DATABASE IF EXISTS marketplace WITH (FORCE)' -c 'DROP DATABASE IF EXISTS shadow WITH (FORCE)' -c 'CREATE DATABASE marketplace' -c 'CREATE DATABASE shadow' && docker exec pgs-test-redis redis-cli FLUSHALL"
run db_migrate "pnpm db:migrate"
run migration_drift "cd packages/database && node scripts/prisma-cli.js migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:postgres@localhost:55432/shadow --exit-code"
run db_seed "pnpm db:seed:local"
run build_monorepo "pnpm build --concurrency=2"
run build_api_worker "pnpm --filter @nexus/api --filter @nexus/worker build"
run worker_smoke "pnpm worker:smoke"
for n in $(seq 4 18); do run "acceptance_phase$n" "pnpm test:acceptance:phase$n"; done
run acceptance_services "pnpm test:acceptance:services"
ARGS="--build-arg NEXT_PUBLIC_API_URL=https://api.example.vn --build-arg NEXT_PUBLIC_SITE_URL=https://example.vn --build-arg NEXT_PUBLIC_PORTAL_URL=https://app.example.vn"
for t in api worker migrate; do run "docker_$t" "docker build -q -f infra/docker/Dockerfile --target $t $ARGS -t pgs-qa-$t ."; done
for app in web portal admin; do run "docker_next_$app" "docker build -q -f infra/docker/Dockerfile --target next --build-arg APP=$app $ARGS -t pgs-qa-$app ."; done

printf "finished\t%s\n" "$(date -u +%FT%TZ)" >> "$OUT/env.tsv"
echo "VERIFY_DONE sha=$SHA"
cut -f1,3,5 "$LOG" | column -t
