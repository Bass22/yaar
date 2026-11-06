# syntax=docker/dockerfile:1

# Image of the API. Build context: the repository root.
#   docker build -f infra/docker/api.Dockerfile .
# Adapted from build-track (backend/Dockerfile).

# --- build stage: install everything, bundle the application ---
FROM node:22-slim AS builder
WORKDIR /app

# Deterministic install from the lockfile; `.npmrc` blocks install scripts here too.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# The bundle inlines the application code and the workspace packages it imports. Prisma stays
# external (`packages: 'external'`): its client is generated in the runtime stage.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN node apps/api/build.mjs

# --- runtime stage: production dependencies and the bundle, nothing else ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Prisma probes the OpenSSL version to pick its engine; `node:22-slim` ships libssl without
# the `openssl` package, and the probe would fall back to a guess. On the layer that talks to
# the database, the engine is chosen, not guessed (build-track, backend/Dockerfile).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# Schema and migrations: the same image runs `prisma migrate deploy` as a one-shot task.
COPY apps/api/prisma ./prisma

# Install scripts are blocked, so Prisma has fetched nothing yet. Generating the client fetches
# the query engine; computing the migration script (no database involved) fetches the engine
# `migrate deploy` needs. Both happen here, at build time: at run time the container has no
# route to the internet and no right to write in node_modules.
RUN DATABASE_URL=postgresql://build@localhost/build npx prisma generate --schema prisma/schema.prisma \
  && DATABASE_URL=postgresql://build@localhost/build npx prisma migrate diff \
       --from-empty --to-schema-datamodel prisma/schema.prisma --script > /dev/null

COPY --from=builder /app/apps/api/dist ./dist

# The official image ships an unprivileged `node` user: the API never runs as root.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
