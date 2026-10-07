# syntax=docker/dockerfile:1.7
#
# NexusTheme production images (one Dockerfile, several targets).
#
#   docker build -f infra/docker/Dockerfile --target api     -t nexustheme-api .
#   docker build -f infra/docker/Dockerfile --target worker  -t nexustheme-worker .
#   docker build -f infra/docker/Dockerfile --target migrate -t nexustheme-migrate .
#   docker build -f infra/docker/Dockerfile --target next --build-arg APP=web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.vn ... -t nexustheme-web .
#
# infra/docker/production-compose.yml wires all of these together.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
# Dependency layer: only the lockfile invalidates the package download cache.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile
# Shared packages first (includes `prisma generate` for the Linux engine).
RUN pnpm -r --filter "./packages/**" run build

# ---------------------------------------------------------------------------
# One-off job: apply migrations and the production-safe RBAC seed.
FROM build AS migrate
ENV NODE_ENV=production
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed:system"]

# ---------------------------------------------------------------------------
FROM build AS build-backend
RUN pnpm --filter @nexus/api run build \
 && pnpm --filter @nexus/worker run build

FROM base AS backend-runtime
ENV NODE_ENV=production
COPY --from=build-backend --chown=node:node /repo /repo
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM backend-runtime AS api
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM backend-runtime AS worker
WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# Next.js apps (web | portal | admin). NEXT_PUBLIC_* values are inlined into
# the browser bundle at build time, so they are build arguments.
FROM build AS build-next
ARG APP
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_WEB_URL
ARG NEXT_PUBLIC_PORTAL_URL
ARG NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NODE_ENV=production \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL} \
    NEXT_PUBLIC_PORTAL_URL=${NEXT_PUBLIC_PORTAL_URL} \
    NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
RUN test -n "$APP" || (echo "APP build-arg is required (web|portal|admin)" && exit 1)
RUN pnpm --filter "@nexus/${APP}" run build \
 && mkdir -p "apps/${APP}/public"

FROM ${NODE_IMAGE} AS next
ARG APP
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    APP_DIR=apps/${APP}
WORKDIR /app
COPY --from=build-next --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build-next --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build-next --chown=node:node /repo/apps/${APP}/public ./apps/${APP}/public
USER node
CMD ["sh", "-c", "node ${APP_DIR}/server.js"]
