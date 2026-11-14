# syntax=docker/dockerfile:1

# Image of the web app. Two stages — Node builds, Caddy serves — so that only static files
# ship: no Node, no node_modules, no sources. Build context: the repository root.
#   docker build -f infra/docker/web.Dockerfile .
# Adapted from build-track (frontend/Dockerfile).

# --- build stage ---
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder
WORKDIR /app
ENV CI=true NX_DAEMON=false

# Deterministic install from the lockfile; `.npmrc` blocks install scripts here too.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Production build: bundle budgets and hashed file names. A budget overrun fails here.
COPY nx.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npx nx build web

# --- runtime stage ---
FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
COPY --from=builder /app/dist/apps/web/browser /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
