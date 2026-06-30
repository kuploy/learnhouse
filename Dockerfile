# ───────────────────────────────────────────────
# Stage 1: Frontend dependency install
# ───────────────────────────────────────────────
FROM oven/bun:1-alpine AS frontend-deps
RUN apk update && apk add --no-cache libc6-compat && rm -rf /var/cache/apk/*
WORKDIR /app

COPY apps/web/package.json apps/web/bun.lock* ./
RUN bun install --frozen-lockfile

# ───────────────────────────────────────────────
# Stage 2: Frontend build
# ───────────────────────────────────────────────
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY apps/web .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Remove .env files to avoid leaking secrets into the build
RUN rm -f .env*

RUN bun run build

# ───────────────────────────────────────────────
# Stage 3: Frontend production image
# ───────────────────────────────────────────────
FROM node:24-alpine AS frontend-runner
WORKDIR /app

RUN apk update && apk add --no-cache curl && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=frontend-builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

# Leverage output traces to reduce image size
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy server wrapper for runtime environment variable injection
COPY --chown=nextjs:nodejs apps/web/server-wrapper.js ./
RUN chmod +x server-wrapper.js

# ───────────────────────────────────────────────
# Stage 4: Collab server build
# ───────────────────────────────────────────────
FROM oven/bun:1-alpine AS collab-builder
WORKDIR /app

COPY apps/collab/package.json apps/collab/bun.lock* ./
RUN bun install --frozen-lockfile

COPY apps/collab/tsconfig.json ./
COPY apps/collab/src/ ./src/

RUN bun run build

# Prune to production deps so the runtime image can copy node_modules directly
# (devDeps like tsx/typescript were only needed for the tsc build above).
RUN bun install --production --frozen-lockfile

# ───────────────────────────────────────────────
# Stage 5: Final image combining frontend + backend + collab
# ───────────────────────────────────────────────
FROM python:3.14.3-slim-bookworm AS runner

# Single apt layer: nginx, curl, netcat, node, pm2. No bun here — it's only a
# build-time tool (the runtime runs node/pm2/uv), so it stays out of the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl netcat-openbsd ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pm2 \
    && apt-get purge -y gnupg \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm \
    && rm /etc/nginx/sites-enabled/default

# Copy the frontend standalone build
COPY --from=frontend-runner /app /app/web

# Backend: install deps first (better layer caching). build-essential is needed
# only to compile Python wheels during `uv sync`, so install and purge it in the
# same layer — it never lands in the final image.
WORKDIR /app/api
COPY ./apps/api/uv.lock ./apps/api/pyproject.toml ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir --upgrade pip uv \
    && uv sync --no-dev \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY ./apps/api ./

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/api/ee; fi

# Collab server: copy built JS + the production node_modules from the builder.
# package.json carries "type": "module" so node treats dist/*.js as ESM.
WORKDIR /app/collab
COPY --from=collab-builder /app/dist ./dist
COPY --from=collab-builder /app/node_modules ./node_modules
COPY apps/collab/package.json ./

# Copy configs and scripts
WORKDIR /app
COPY ./docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./apps/api/docker-entrypoint.sh /app/api/docker-entrypoint.sh
COPY ./docker/start.sh /app/start.sh
RUN chmod +x /app/api/docker-entrypoint.sh /app/start.sh

ENV PORT=8000 LEARNHOUSE_PORT=9000 COLLAB_PORT=4000 HOSTNAME=0.0.0.0 LEARNHOUSE_OSS=true NEXT_PUBLIC_LEARNHOUSE_OSS=true

EXPOSE 80 9000 4000

CMD ["sh", "/app/start.sh"]
