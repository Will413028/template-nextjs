FROM node:26.12.1-slim@sha256:94816674c62774da0d099a947bf4613b9e1972a2733abd0d0cd80e795f8411d0 AS base

# Node.js 25 and newer ship without corepack: install the pnpm that package.json's packageManager names, so that field
# stays the one place the version is set. pnpm's own install script links its native binary in place of a
# shebang-less placeholder, which an exec-form CMD cannot run, so it is the one install here that runs scripts. The
# runner stage starts from base and carries no pnpm.
FROM base AS pnpm
WORKDIR /app
COPY package.json ./
RUN npm install --global --no-audit --no-fund \
      "pnpm@$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"

FROM pnpm AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# production dependencies only, for the migrate image: drizzle-orm and pg, none of the dev tooling
FROM pnpm AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# make dev: next dev with installed dependencies; docker-compose.dev.yml mounts src/ and messages/ over the copy so
# edits reload
FROM deps AS dev
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["pnpm", "dev"]

# The compose migrate service: scripts/migrate.mts with the installed drizzle-orm and pg (the standalone server below
# bundles drizzle-orm into .next and carries no migrator). Node.js runs the TypeScript file by stripping its types.
FROM base AS migrate
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY migrations ./migrations
COPY scripts/migrate.mts ./scripts/migrate.mts
USER 1001:1001
CMD ["node", "scripts/migrate.mts"]

FROM pnpm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Records each request's TCP peer before Next.js runs (peer.cjs; ADR auth-and-sign-in-throttling D1, deviation 2); the
# app refuses sign-up and sign-in without it.
COPY --from=builder /app/peer.cjs ./peer.cjs
ENV NODE_OPTIONS="--require=/app/peer.cjs"

# nextjs:nodejs, by number so a runtime can verify it is not root without reading /etc/passwd
USER 1001:1001
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Readiness, including the database (src/app/api/health/route.ts); slim images have no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
