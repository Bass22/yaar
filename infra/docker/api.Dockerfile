# syntax=docker/dockerfile:1

# Images of the API. Build context: the repository root. Two targets:
#   runtime — the API itself:                 docker build -f infra/docker/api.Dockerfile --target runtime .
#   migrate — the one-shot migration task:    docker build -f infra/docker/api.Dockerfile --target migrate .
# Adapted from build-track (backend/Dockerfile).

# --- build stage: install everything, generate the database client, bundle the application ---
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder
WORKDIR /app

# Deterministic install from the lockfile; `.npmrc` blocks install scripts here too.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# The Prisma client is plain JavaScript, written to node_modules/.prisma: no engine to fetch.
RUN npx prisma generate --config apps/api/prisma.config.ts

# The bundle inlines the application code and the workspace packages it imports; packages of
# node_modules stay external (`packages: 'external'`).
RUN node apps/api/build.mjs

# --- migrate stage: the Prisma command line, the schema and the migrations. Never serves. ---
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS migrate
ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
WORKDIR /app

# The migration engine probes the OpenSSL version to pick its build; `node:22-slim` ships
# libssl without the `openssl` package, and the probe would fall back to a guess.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Production dependencies and the optional ones: the Prisma command line is an optional peer
# of its client, so this install brings it without any development tooling.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY apps/api/prisma ./apps/api/prisma

# The provisioning scripts (a farm with its first site and admin; another admin) run here, as the owner:
#   docker compose run --rm -it migrate node dist/bootstrap-tenant.js --tenant … (the PIN is asked)
#   docker compose run --rm -it migrate node dist/add-admin.js --tenant-id … (the PIN is asked)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/api/dist ./dist

# Install scripts are blocked, so the migration engine has not been fetched yet. Computing the
# migration script (no database involved) fetches it here, at build time: at run time this
# container has no route to the internet and no right to write in node_modules.
RUN npx prisma migrate diff --config apps/api/prisma.config.ts \
      --from-empty --to-schema apps/api/prisma/schema.prisma --script > /dev/null

USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "apps/api/prisma.config.ts"]

# --- runtime stage: production dependencies, the generated client and the bundle ---
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `--omit=optional` as well: the Prisma command line is an optional peer of its client, and
# would otherwise come along with a MySQL driver, a studio and a development server.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/apps/api/dist ./dist

# The media volume (M.1): owned by `node`, so a fresh named volume mounted here inherits it.
RUN mkdir -p /data/medias && chown node:node /data/medias

# The official image ships an unprivileged `node` user: the API never runs as root.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
