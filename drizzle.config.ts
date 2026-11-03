import { defineConfig } from "drizzle-kit";

// Each feature owns its tables in src/features/<name>/schema.ts. `pnpm db:generate` writes the next migration to
// migrations/ from the difference with the last snapshot; it needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/features/*/schema.ts",
  out: "./migrations",
  strict: true,
});
