// Applies migrations/ as the database owner role and grants the app role DML on everything the owner made.
// Run by the compose `migrate` service (`node scripts/migrate.mts`: Node.js runs TypeScript by stripping types, and
// .mts makes it an ES module) and by the integration tests. Reruns converge: the migrator skips applied migrations
// and the grants are idempotent.
//
// Environment: MIGRATE_DATABASE_URL (the owner role, without a password), MIGRATE_DATABASE_PASSWORD_FILE, DB_APP_USER.
//
// Drizzle's migrator applies every pending migration in one transaction, so a failure leaves none of them applied,
// and CREATE INDEX CONCURRENTLY cannot run (squawk rejects it, .squawk.toml).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export type MigrateOptions = {
  connectionString: string;
  password: string;
  appRole: string;
  migrationsFolder?: string;
};

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(options: MigrateOptions): Promise<void> {
  // pg lets a connectionString override a separately given password, so the URL is split into fields.
  const url = new URL(options.connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    database: decodeURIComponent(url.pathname.slice(1)),
    password: options.password,
    // Waits at most this long for a lock (a running query on a table being altered) instead of queueing every
    // later query behind the migration.
    options: "-c lock_timeout=10s",
  });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: options.migrationsFolder ?? MIGRATIONS,
    });
    const app = client.escapeIdentifier(options.appRole);
    // The migrator's ledger lives in the drizzle schema, which the app role gets no access to.
    await client.query("BEGIN");
    await client.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

if (import.meta.main) {
  const password = readFileSync(
    required("MIGRATE_DATABASE_PASSWORD_FILE"),
    "utf8",
  ).trim();
  await migrateDatabase({
    connectionString: required("MIGRATE_DATABASE_URL"),
    password,
    appRole: required("DB_APP_USER"),
  });
  console.log("migrations applied, app role granted");
}
