# syntax=docker/dockerfile:1
# Multi-stage build for the Dumyat Public Hospital site (Astro) + Payload CMS (Next.js).
# PID 1 is docker/supervisor.mjs — manages both processes per ASTRO_MODE / PAYLOAD_MODE.
#
# Size strategy: pnpm's isolated `.pnpm` store retains devDependencies even under `pnpm install
# --prod` (--prod only filters linking). The `prod-deps` stage does a --prod install then runs
# docker/prune-store.mjs to delete the now-unreferenced devDeps from the store, so the runtime
# ships a prod-only shared workspace node_modules. The runtime COPYs are selective (not a full
# /app copy) so build caches / source bleed-through don't ship.

############################
# base — build tools (native bindings) + corepack
############################
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY astro/package.json ./astro/
COPY cms/package.json ./cms/

############################
# prod-deps — production node_modules + pruned store (devDeps removed)
############################
FROM base AS prod-deps
RUN pnpm install --prod --no-frozen-lockfile
COPY docker/prune-store.mjs /tmp/prune-store.mjs
RUN node /tmp/prune-store.mjs /app

############################
# build — full deps (devDeps needed to compile), then build both apps
############################
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY astro ./astro
COPY cms ./cms
ARG PAYLOAD_SECRET=build-time-placeholder-replaced-at-runtime-0123456789ab
ARG DATABASE_URI=file:/tmp/cms-build.db
RUN PAYLOAD_SECRET="$PAYLOAD_SECRET" DATABASE_URI="$DATABASE_URI" \
    PAYLOAD_PUBLIC_SERVER_URL=http://localhost:3001 \
    pnpm --filter @bitrails-works/cms run build \
 && pnpm --filter @bitrails-works/astro run build

############################
# runtime — lean: prod node_modules + built outputs, non-root
############################
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    ASTRO_MODE=in-process \
    ASTRO_AUTOSTART=true \
    PAYLOAD_MODE=inactivity-timeout \
    PAYLOAD_AUTOSTART=false \
    PAYLOAD_INACTIVITY_TIMEOUT_MS=900000 \
    PAYLOAD_MIGRATE_ON_BOOT=true \
    DATABASE_URI=file:/data/cms.db \
    HOST=0.0.0.0 \
    SUPERVISOR_CONTROL_URL=http://127.0.0.1:9223 \
    CMS_INTERNAL_ORIGIN=http://127.0.0.1:3001
WORKDIR /app
# Prod-only node_modules (pruned store). --chown so the node user can read/exec everything.
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=prod-deps /app/astro/node_modules ./astro/node_modules
COPY --chown=node:node --from=prod-deps /app/cms/node_modules ./cms/node_modules
COPY --chown=node:node --from=prod-deps /app/package.json ./package.json
COPY --chown=node:node --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --chown=node:node --from=prod-deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
# Built outputs + the small files each app needs at runtime (no .astro/.next/cache, no host bleed).
COPY --chown=node:node --from=build /app/astro/dist ./astro/dist
COPY --chown=node:node --from=build /app/astro/public ./astro/public
COPY --chown=node:node --from=build /app/astro/package.json ./astro/package.json
COPY --chown=node:node --from=build /app/cms/.next ./cms/.next
COPY --chown=node:node --from=build /app/cms/src ./cms/src
COPY --chown=node:node --from=build /app/cms/scripts ./cms/scripts
COPY --chown=node:node --from=build /app/cms/tsconfig.json ./cms/tsconfig.json
COPY --chown=node:node --from=build /app/cms/package.json ./cms/package.json
COPY --chown=node:node --from=build /app/cms/next.config.mjs ./cms/next.config.mjs
COPY --chown=node:node docker ./docker
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CONTROL_PORT||'9223')+'/internal/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker/supervisor.mjs"]
