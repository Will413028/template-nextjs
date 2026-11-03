import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { items } from "./schema.ts";

// Keyset page of one owner's items, newest first (uuidv7 ids are time-ordered), like the Go items list.
export function listItems(db: NodePgDatabase, ownerId: string, limit: number, after?: string) {
  return db
    .select({ id: items.id, title: items.title, createdAt: items.createdAt })
    .from(items)
    .where(and(eq(items.ownerId, ownerId), after ? lt(items.id, after) : undefined))
    .orderBy(desc(items.id))
    .limit(limit);
}
export { sql };
