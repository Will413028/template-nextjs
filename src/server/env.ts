import "server-only";
import { readFileSync } from "node:fs";
import { z } from "zod";

// The one module that reads server configuration from process.env (Biome's noProcessEnv is off for this file).
// Each value is read when it is first needed, not at import, so `next build` needs none of them.

const databaseEnv = z.object({
  // postgres://<app role>@<host>:<port>/<database>, without the password
  DATABASE_URL: z.url(),
  // a file holding the app role's password (compose secret), so it is not in the environment
  DATABASE_PASSWORD_FILE: z.string().min(1),
  DB_MAX_CONNS: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  maxConnections: number;
  statementTimeoutMs: number;
};

export function databaseConfig(): DatabaseConfig {
  const env = databaseEnv.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_PASSWORD_FILE: process.env.DATABASE_PASSWORD_FILE,
    DB_MAX_CONNS: process.env.DB_MAX_CONNS || undefined,
    DB_STATEMENT_TIMEOUT_MS: process.env.DB_STATEMENT_TIMEOUT_MS || undefined,
  });
  const password = readFileSync(env.DATABASE_PASSWORD_FILE, "utf8").trim();
  if (password === "") {
    throw new Error(`${env.DATABASE_PASSWORD_FILE} is empty`);
  }
  return {
    ...connectionFields(env.DATABASE_URL),
    password,
    maxConnections: env.DB_MAX_CONNS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  };
}

// pg lets a connectionString override a separately given password (with undefined, when the URL has none), so the
// URL is split into fields instead.
export function connectionFields(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    database: decodeURIComponent(u.pathname.slice(1)),
  };
}
