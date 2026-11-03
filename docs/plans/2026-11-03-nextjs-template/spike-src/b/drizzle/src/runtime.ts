// Runs as the APP role: DML works, DDL refused, bookkeeping table visibility, keyset query SQL + plan.
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { items, sessions, users } from "./schema.ts";
import { listItems } from "./queries.ts";

const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL });
const db = drizzle(pool, { logger: { logQuery: (q, p) => console.log("SQL>", q, JSON.stringify(p)) } });
const who = await pool.query("select current_user");
console.log("connected as", who.rows[0].current_user);

const [u] = await db.insert(users).values({ account: `alice${Date.now()}`, passwordHash: "x" }).returning();
const ids: string[] = [];
for (let i = 0; i < 5; i++) ids.push((await db.insert(items).values({ title: `t${i}`, ownerId: u.id }).returning({ id: items.id }))[0].id);
await db.insert(sessions).values({ tokenHash: randomBytes(32), userId: u.id, createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) });
await db.update(items).set({ title: "renamed" }).where(eq(items.id, ids[0]));
const page1 = await listItems(db, u.id, 2);
const page2 = await listItems(db, u.id, 2, page1[1].id);
console.log("page1", page1.map((r) => r.title), "page2", page2.map((r) => r.title), "createdAt is Date:", page1[0].createdAt instanceof Date);
const s = await db.select().from(sessions).where(eq(sessions.userId, u.id));
console.log("token_hash Buffer:", Buffer.isBuffer(s[0].tokenHash), s[0].tokenHash.length);

for (const [label, q] of [
  ["CHECK short token", () => db.insert(sessions).values({ tokenHash: randomBytes(5), userId: u.id, createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date() })],
  ["CHECK upper account", () => db.insert(users).values({ account: "Alice", passwordHash: "x" })],
] as const) {
  try { await q(); console.log(label, "UNEXPECTED OK"); } catch (e: any) { console.log(label, "->", e.cause?.code ?? e.code, e.cause?.message ?? e.message); }
}
await db.delete(users).where(eq(users.id, u.id));
const left = await pool.query("select count(*)::int n from items where owner_id = $1", [u.id]);
console.log("items after user delete (cascade):", left.rows[0].n);

for (const stmt of ["CREATE TABLE evil (id int)", "ALTER TABLE items ADD COLUMN evil int", "DROP TABLE items", "TRUNCATE items", "CREATE SCHEMA evil", "SELECT * FROM drizzle.__drizzle_migrations", "SELECT * FROM public._prisma_migrations"]) {
  try { const r = await pool.query(stmt); console.log("UNEXPECTED OK:", stmt, r.rowCount); } catch (e: any) { console.log("refused:", stmt, "->", e.code, e.message); }
}
await pool.end();
