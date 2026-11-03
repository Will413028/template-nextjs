import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only throws outside a React Server Components bundle; tests import server modules directly
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Random file and test order, so a test that depends on another's leftovers fails; the run prints its seed, and
    // --sequence.seed=<seed> replays that order.
    sequence: { shuffle: true },
    // next-intl's middleware imports "next/server" without an extension, which Node's ESM resolver rejects;
    // inlining lets Vite resolve it (proxy.test.ts).
    server: { deps: { inline: ["next-intl"] } },
    projects: [
      // pnpm test, pnpm check and the pre-push hook
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.{ts,tsx}"] },
      },
      // pnpm test:integration: PostgreSQL in Docker (testcontainers); CI runs it
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          hookTimeout: 180_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
