// Layering for src/ (see "Dependency direction" in AGENTS.md). Every rule is an error and there are no exceptions:
// fix a violation by moving code, not by adding a known-violations file.
//
// Each feature is a vertical slice (src/features/<name>/): its Drizzle tables (schema.ts), its data access
// (server/), its Server Actions (actions.ts) and its components. src/server/ is the thin kernel every feature shares
// (database pool, server configuration).
const SHARED = "^src/(lib|components|hooks|i18n)/";
// pnpm resolves a package to node_modules/.pnpm/<name>@<version>/node_modules/<name>/, so a package path matches
// either layout.
const pkg = (name) => [
  `^node_modules/${name}/`,
  `^node_modules/\\.pnpm/[^/]+/node_modules/${name}/`,
];
// Only these may reach the database: a feature's server code, the kernel, and the health check.
const DATABASE_USERS = [
  "^src/features/[^/]+/server/",
  "^src/server/",
  "^src/app/api/health/route\\.ts$",
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "An import cycle ties its modules into one unit that cannot change or be tested apart.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "shared-not-to-features-app-or-server",
      comment:
        "lib, components, hooks and i18n are shared by every feature, run on the client too, and never depend on a feature, a route or server code.",
      severity: "error",
      from: { path: SHARED },
      to: { path: "^src/(features|app|server)/" },
    },
    {
      name: "server-kernel-only-to-lib",
      comment:
        "src/server/ is the kernel under every feature: it may use lib/ and nothing else in src/.",
      severity: "error",
      from: { path: "^src/server/" },
      to: { path: "^src/", pathNot: ["^src/server/", "^src/lib/"] },
    },
    {
      name: "features-not-to-app",
      comment: "Routes compose features; a feature never imports a route.",
      severity: "error",
      from: { path: "^src/features/" },
      to: { path: "^src/app/" },
    },
    {
      name: "feature-public-api-from-outside",
      comment:
        "Outside a feature, import it through index.ts (client-safe), server.ts (server-only) or schema.ts (its tables).",
      severity: "error",
      from: { pathNot: "^src/features/" },
      to: {
        path: "^src/features/[^/]+/",
        pathNot: "^src/features/[^/]+/(index|server|schema)\\.ts$",
      },
    },
    {
      name: "feature-public-api-between-features",
      comment:
        "One feature reaches another only through its index.ts, server.ts or schema.ts.",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to: {
        path: "^src/features/[^/]+/",
        pathNot: [
          "^src/features/$1/",
          "^src/features/[^/]+/(index|server|schema)\\.ts$",
        ],
      },
    },
    {
      name: "auth-is-the-base-feature",
      comment:
        "Every feature may build on auth (sessions, the viewer); auth depends on no other feature.",
      severity: "error",
      from: { path: "^src/features/auth/" },
      to: { path: "^src/features/", pathNot: "^src/features/auth/" },
    },
    {
      name: "schema-is-table-definitions-only",
      comment:
        "drizzle-kit loads schema.ts outside Next.js: it may import only drizzle-orm (table builders, sql) and other features' tables, never a driver.",
      severity: "error",
      from: { path: "^src/features/[^/]+/schema\\.ts$" },
      to: {
        // drizzle-orm's table builders and sql``; a driver is caught by database-only-from-server-code
        pathNot: ["^src/features/[^/]+/schema\\.ts$", ...pkg("drizzle-orm")],
      },
    },
    {
      name: "database-only-from-server-code",
      comment:
        "The database (the pool in src/server/db.ts and the pg driver) is reached only from a feature's server/ modules, the kernel and the health check. drizzle-orm's query builder (eq, sql) holds no connection.",
      severity: "error",
      from: { pathNot: DATABASE_USERS },
      to: {
        path: [
          "^src/server/db\\.ts$",
          ...pkg("pg"),
          ...pkg("drizzle-orm/node-postgres"),
        ],
      },
    },
    {
      name: "client-side-not-to-server-code",
      comment:
        "A feature's index.ts and components, and the shared components and hooks, can end up in the browser bundle: they never import server code.",
      severity: "error",
      from: {
        path: [
          "^src/features/[^/]+/(index\\.ts$|components/)",
          "^src/(components|hooks)/",
        ],
      },
      to: {
        path: ["^src/features/[^/]+/(server\\.ts$|server/)", "^src/server/"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
