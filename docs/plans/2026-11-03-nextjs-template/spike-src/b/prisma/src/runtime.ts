// Runs as the APP role through @prisma/adapter-pg: DML works, DDL refused, bookkeeping visibility, emitted SQL.
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "./generated/prisma/client.ts";
import { listItems, listItemsCursor } from "./queries.ts";

const adapter = new PrismaPg({ connectionString: process.env.APP_DATABASE_URL });
const db = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
db.$on("query", (e) => console.log("SQL>", e.query, e.params));
console.log("connected as", (await db.$queryRaw<{ u: string }[]>`select current_user as u`)[0].u);

const u = await db.user.create({ data: { account: `alice${Date.now()}`, passwordHash: "x" } });
const ids: string[] = [];
for (let i = 0; i < 5; i++) ids.push((await db.item.create({ data: { title: `t${i}`, ownerId: u.id }, select: { id: true } })).id);
await db.session.create({ data: { tokenHash: randomBytes(32), userId: u.id, createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) } });
await db.item.update({ where: { id: ids[0] }, data: { title: "renamed" } });
const p1 = await listItems(db, u.id, 2);
const p2 = await listItems(db, u.id, 2, p1[1].id);
console.log("page1", p1.map((r) => r.title), "page2", p2.map((r) => r.title), "createdAt is Date:", p1[0].createdAt instanceof Date);
console.log("--- cursor variant");
const c2 = await listItemsCursor(db, u.id, 2, p1[1].id);
console.log("cursor page2", c2.map((r) => r.title));
console.log("--- nested include (relation load)");
await db.user.findUnique({ where: { id: u.id }, include: { items: { take: 2, orderBy: { id: "desc" } } } });
const s = await db.session.findMany({ where: { userId: u.id } });
console.log("token_hash type:", s[0].tokenHash.constructor.name, s[0].tokenHash.length);
for (const [label, q] of [
  ["CHECK short token", () => db.session.create({ data: { tokenHash: randomBytes(5), userId: u.id, createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date() } })],
  ["CHECK upper account", () => db.user.create({ data: { account: "Alice", passwordHash: "x" } })],
] as const) {
  try { await q(); console.log(label, "UNEXPECTED OK"); } catch (e: any) { console.log(label, "->", e.code, (e.message as string).split("\n").filter(Boolean).slice(-1)[0]); }
}
await db.user.delete({ where: { id: u.id } });
console.log("items after user delete (cascade):", await db.item.count({ where: { ownerId: u.id } }));
for (const stmt of ["CREATE TABLE evil (id int)", "ALTER TABLE items ADD COLUMN evil int", "DROP TABLE items", "TRUNCATE items", "CREATE SCHEMA evil", "SELECT count(*) FROM public._prisma_migrations", "UPDATE public._prisma_migrations SET logs = 'app wrote here'"]) {
  try { const r = await db.$executeRawUnsafe(stmt); console.log("UNEXPECTED OK:", stmt, "rows:", r); } catch (e: any) { console.log("refused:", stmt, "->", e.code, e.meta?.driverAdapterError?.cause?.originalCode ?? "", (e.message as string).split("\n").filter(Boolean).slice(-1)[0]); }
}
await db.$disconnect();
