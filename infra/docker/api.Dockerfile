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

# The bundle inlines the application code and the workspace packages it imports.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN node apps/api/build.mjs

# --- runtime stage: production dependencies and the bundle, nothing else ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/apps/api/dist ./dist

# The official image ships an unprivileged `node` user: the API never runs as root.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
