// testcontainers + vitest: PG 18 with the Go template's 10-roles.sh, `prisma migrate deploy` as owner (CLI; Prisma has
// no programmatic migrate API), grant, query as app through @prisma/adapter-pg.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaPg } from "@prisma/adapter-pg";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { listItems } from "../src/queries.ts";

const SPIKE = new URL("../../pg/", import.meta.url).pathname;
let c: StartedPostgreSqlContainer;
let db: PrismaClient;
const url = (u: string, p: string) => `postgres://${u}:${p}@${c.getHost()}:${c.getMappedPort(5432)}/spike`;

beforeAll(async () => {
  c = await new PostgreSqlContainer("postgres:18")
    .withName(`spike-b-tc-prisma-${process.pid}`)
    .withDatabase("spike").withPassword("super_spike_pw")
    .withEnvironment({ DB_OWNER_USER: "spike_owner", DB_APP_USER: "spike_app" })
    .withCopyFilesToContainer([
      { source: `${SPIKE}initdb/10-roles.sh`, target: "/docker-entrypoint-initdb.d/10-roles.sh", mode: 0o755 },
      { source: `${SPIKE}secrets/db_owner_password`, target: "/run/secrets/db_owner_password" },
      { source: `${SPIKE}secrets/db_app_password`, target: "/run/secrets/db_app_password" },
    ])
    .start();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, MIGRATE_DATABASE_URL: url("spike_owner", "owner_spike_pw") }, stdio: "inherit" });
  const owner = new pg.Client({ connectionString: url("spike_owner", "owner_spike_pw") });
  await owner.connect();
  await owner.query(readFileSync(`${SPIKE}grant.sql`, "utf8"));
  await owner.end();
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url("spike_app", "app_spike_pw") }) });
}, 180_000);
afterAll(async () => { await db?.$disconnect(); await c?.stop(); });

test("app role: DML and typed keyset query", async () => {
  const u = await db.user.create({ data: { account: "carol", passwordHash: "x" } });
  for (const t of ["a", "b", "c"]) await db.item.create({ data: { title: t, ownerId: u.id } });
  const page = await listItems(db, u.id, 2);
  expect(page.map((r) => r.title)).toEqual(["c", "b"]);
  expect((await listItems(db, u.id, 2, page[1].id)).map((r) => r.title)).toEqual(["a"]);
});

test("app role: DDL refused; _prisma_migrations readable+writable under Go-style grant", async () => {
  await expect(db.$executeRawUnsafe("CREATE TABLE evil (id int)")).rejects.toThrow(/42501/);
  await expect(db.$executeRawUnsafe("DROP TABLE items")).rejects.toThrow(/42501/);
  await expect(db.$executeRawUnsafe("UPDATE _prisma_migrations SET logs = 'x'")).resolves.toBeGreaterThan(0);
});
