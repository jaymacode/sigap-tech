# ============================================================================
# Stage 1: Base & Dependencies
# ============================================================================
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 2: Builder
# Berisi dev dependencies, tests/, dan db/. Target ini juga dipakai service `test`
# di docker-compose.yml (--profile test).
# ============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Jalankan build standalone Next.js
RUN pnpm build

# ============================================================================
# Stage 3: Tools
# Hanya `pg` (versi yang dikunci di pnpm-lock.yaml) dipasang ke prefix terpisah.
# Alasannya: scripts/migrate.js dijalankan langsung dengan `node`, dan Next standalone
# hanya menelusuri (trace) dependensi yang di-import kode server. Dengan prefix ini
# migrate.js selalu punya driver pg, tanpa menyalin node_modules pnpm (berisi symlink).
# ============================================================================
FROM node:22-alpine AS tools
ARG PG_VERSION=8.23.1
WORKDIR /opt/sigap-tools
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock \
    --prefix /opt/sigap-tools pg@${PG_VERSION}

# ============================================================================
# Stage 4: Runner (Production Runtime)
# ============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl bash

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Fallback resolusi modul untuk scripts/*.js (pg). Modul di /app/node_modules tetap diprioritaskan.
ENV NODE_PATH=/opt/sigap-tools/node_modules

# Setup non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Driver pg untuk skrip (migrate.js, seed.js, worker.js)
COPY --from=tools /opt/sigap-tools/node_modules /opt/sigap-tools/node_modules

# Salin public dan file statis Next.js standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrasi SQL. scripts/migrate.js membaca ../db/migrations relatif terhadap __dirname (/app/scripts)
COPY --from=builder --chown=nextjs:nodejs /app/db ./db

# Salin scripts untuk migrate, seed, dan worker
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
RUN chmod +x ./scripts/*.sh ./scripts/*.js 2>/dev/null || true

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
