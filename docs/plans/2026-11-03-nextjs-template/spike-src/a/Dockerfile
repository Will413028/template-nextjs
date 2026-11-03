# Spike: Next.js standalone image. BASE=node:24-alpine (musl) or node:24-bookworm-slim (glibc).
ARG BASE=node:24-alpine
FROM ${BASE} AS build
WORKDIR /app
RUN npm install -g pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${BASE}
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/peer.cjs ./peer.cjs
USER node
EXPOSE 3000
CMD ["node", "server.js"]
