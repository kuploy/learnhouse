# LearnHouse docs site (Nextra) as a small standalone Next.js server image —
# the `learnhouse-docs` stack component. Served directly by Node; kuploy's
# ingress fronts it (no nginx needed for a single app).

# ── Build ──────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app
# `bun run build` runs `node scripts/generate-llms-full.mjs` + next build +
# the pagefind/sitemap postbuild — so the builder needs the node binary too.
RUN apk add --no-cache libc6-compat nodejs

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ── Run ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Next standalone output + the static assets and public/ (incl. the pagefind
# search index written to public/_pagefind during postbuild).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
