import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, databaseReady } from "@/server/db";
import { connectionFields } from "@/server/env";
import {
  APP,
  migrateAsOwner,
  OWNER,
  startDatabase,
  type TestDatabase,
} from "./postgres";

let database: TestDatabase;

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

async function asRole(role: string, password: string, sql: string) {
  const client = new pg.Client({
    ...connectionFields(database.url(role)),
    password,
  });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

describe("database roles", () => {
  it("lets the app role read and write the tables the owner migrated", async () => {
    // a table the owner creates after the grants still reaches the app role (default privileges)
    await asRole(OWNER, database.ownerPassword, "CREATE TABLE probe (id int)");
    await asRole(APP, database.appPassword, "INSERT INTO probe VALUES (1)");
    const rows = await asRole(
      APP,
      database.appPassword,
      "SELECT id FROM probe",
    );
    expect(rows.rows).toEqual([{ id: 1 }]);
    await asRole(OWNER, database.ownerPassword, "DROP TABLE probe");
  });

  it("refuses schema changes from the app role", async () => {
    await expect(
      asRole(APP, database.appPassword, "CREATE TABLE intruder (id int)"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("hides the migration ledger from the app role", async () => {
    await expect(
      asRole(
        APP,
        database.appPassword,
        "SELECT * FROM drizzle.__drizzle_migrations",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("converges when migrations run again", async () => {
    await migrateAsOwner(database);
    const applied = await asRole(
      OWNER,
      database.ownerPassword,
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
    );
    // once each, however many migrations exist
    const journal = JSON.parse(
      readFileSync(
        new URL("../../migrations/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: unknown[] };
    expect(applied.rows[0]?.n).toBe(journal.entries.length);
  });
});

describe("databaseReady", () => {
  it("is true when the app role can query", async () => {
    const { db, pool } = createDatabase({
      ...connectionFields(database.url(APP)),
      password: database.appPassword,
      maxConnections: 1,
      statementTimeoutMs: 1000,
    });
    try {
      expect(await databaseReady(db)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("is false when the database refuses the connection", async () => {
    const { db, pool } = createDatabase({
      ...connectionFields(database.url(APP)),
      password: "wrong",
      maxConnections: 1,
      statementTimeoutMs: 1000,
    });
    try {
      expect(await databaseReady(db)).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
