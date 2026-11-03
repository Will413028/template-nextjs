# syntax=docker/dockerfile:1
# Spike: same stage layout as template-go-nextjs frontend/Dockerfile. BASE switches slim vs alpine for the size test.
ARG BASE=node:26.11.1-slim
FROM ${BASE} AS base

FROM base AS pnpm
WORKDIR /app
COPY package.json ./
RUN npm install --global --no-audit --no-fund \
      "pnpm@$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"

FROM pnpm AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM pnpm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL
ARG SPIKE_CACHE_COMPONENTS=0
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} SPIKE_CACHE_COMPONENTS=${SPIKE_CACHE_COMPONENTS}
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# numeric uid/gid; node images already ship user "node" (1000) but we mirror the Go template's 1001
RUN if command -v adduser >/dev/null && adduser --help 2>&1 | grep -q -- '--system'; then \
      (addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nextjs) ; \
    else (addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs); fi
COPY --from=builder /app/public ./public
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
USER 1001:1001
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
