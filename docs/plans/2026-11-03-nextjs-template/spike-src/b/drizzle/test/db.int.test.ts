// testcontainers + vitest: PG 18 with the Go template's 10-roles.sh, migrate as owner, query as app.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { listItems } from "../src/queries.ts";
import { items, users } from "../src/schema.ts";

const SPIKE = new URL("../../pg/", import.meta.url).pathname;
let c: StartedPostgreSqlContainer;
let app: pg.Pool;
const url = (u: string, p: string) => `postgres://${u}:${p}@${c.getHost()}:${c.getMappedPort(5432)}/spike`;

beforeAll(async () => {
  c = await new PostgreSqlContainer("postgres:18")
    .withName(`spike-b-tc-drizzle-${process.pid}`)
    .withDatabase("spike").withPassword("super_spike_pw")
    .withEnvironment({ DB_OWNER_USER: "spike_owner", DB_APP_USER: "spike_app" })
    .withCopyFilesToContainer([
      { source: `${SPIKE}initdb/10-roles.sh`, target: "/docker-entrypoint-initdb.d/10-roles.sh", mode: 0o755 },
      { source: `${SPIKE}secrets/db_owner_password`, target: "/run/secrets/db_owner_password" },
      { source: `${SPIKE}secrets/db_app_password`, target: "/run/secrets/db_app_password" },
    ])
    .start();
  const owner = new pg.Pool({ connectionString: url("spike_owner", "owner_spike_pw") });
  await migrate(drizzle(owner), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  await owner.query(readFileSync(`${SPIKE}grant.sql`, "utf8"));
  await owner.end();
  app = new pg.Pool({ connectionString: url("spike_app", "app_spike_pw") });
}, 120_000);
afterAll(async () => { await app?.end(); await c?.stop(); });

test("app role: DML and typed keyset query", async () => {
  const db = drizzle(app);
  const [u] = await db.insert(users).values({ account: "carol", passwordHash: "x" }).returning();
  for (const t of ["a", "b", "c"]) await db.insert(items).values({ title: t, ownerId: u.id });
  const page = await listItems(db, u.id, 2);
  expect(page.map((r) => r.title)).toEqual(["c", "b"]);
  expect((await listItems(db, u.id, 2, page[1].id)).map((r) => r.title)).toEqual(["a"]);
});

test("app role: DDL refused, bookkeeping hidden", async () => {
  await expect(app.query("CREATE TABLE evil (id int)")).rejects.toMatchObject({ code: "42501" });
  await expect(app.query("DROP TABLE items")).rejects.toMatchObject({ code: "42501" });
  await expect(app.query("SELECT * FROM drizzle.__drizzle_migrations")).rejects.toMatchObject({ code: "42501" });
});
