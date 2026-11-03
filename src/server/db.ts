import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { type DatabaseConfig, databaseConfig } from "./env";

// The app role's connection pool: DML only (deploy/postgres/initdb/10-roles.sh; scripts/migrate.mts grants it).
// Features query through their own server/ modules with Drizzle's query builder; this module knows no schema.

export type Database = NodePgDatabase;

export function createDatabase(config: DatabaseConfig): {
  db: Database;
  pool: pg.Pool;
} {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password,
    max: config.maxConnections,
    statement_timeout: config.statementTimeoutMs,
    connectionTimeoutMillis: 5000,
  });
  // An idle connection the server drops (a database restart) emits "error" on the pool; unhandled, that event would
  // end the whole Node.js process. The pool discards the connection and opens a new one on the next query.
  pool.on("error", (error) => {
    console.error("idle database connection lost", error);
  });
  return { db: drizzle(pool), pool };
}

let shared: Database | undefined;

// The process-wide database, created on first use so that `next build` never connects.
function db(): Database {
  shared ??= createDatabase(databaseConfig()).db;
  return shared;
}

// Readiness: the database answers a query as the app role. Missing configuration counts as not ready.
export async function databaseReady(database?: Database): Promise<boolean> {
  try {
    await (database ?? db()).execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("database not ready", error);
    return false;
  }
}
