// Programmatic migrator (what a production `migrate` container would run instead of drizzle-kit CLI).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
try { await migrate(drizzle(pool), { migrationsFolder: process.argv[2] ?? "./migrations" }); console.log("migrated"); }
catch (e: any) { console.error("migrate failed:", e.cause?.code ?? e.code, e.cause?.message ?? e.message); process.exitCode = 1; }
finally { await pool.end(); }
