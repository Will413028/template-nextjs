import "server-only";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/features/auth/server";
import { type Database, db } from "@/server/db";
import {
  type FieldErrors,
  parseItemPatch,
  parseNewItem,
  parsePage,
} from "../input";
import { items } from "../schema";
import { decodeCursor, encodeCursor } from "./cursor";

// The items feature's data access, ported from template-go-nextjs modules/items (560106d). Every function takes the
// viewer first and every query is scoped to it (ADR api-and-auth-baseline D7a, plan D8): another user's item is not
// found, the same as one that does not exist, so an id reveals nothing about other users' data.

export type Item = typeof items.$inferSelect;

// One page of items, newest first; nextCursor is null on the last page.
export type ItemPage = { items: Item[]; nextCursor: string | null };

type Failure<Code extends string> = {
  ok: false;
  code: Code;
  fields?: FieldErrors;
};
export type Result<T, Code extends string> = ({ ok: true } & T) | Failure<Code>;

const invalid = (fields: FieldErrors) =>
  ({ ok: false, code: "invalid_input", fields }) as const;
const notFound = { ok: false, code: "not_found" } as const;

// An id that is not a UUID names no item: the same answer as one that does not exist (a page's path, or a form's
// hidden field someone changed), and PostgreSQL never sees it.
const itemId = z.uuid();

const owned = (viewer: Viewer, id: string) =>
  and(eq(items.id, id), eq(items.ownerId, viewer.userId));

export function itemQueries(db: Database) {
  async function get(viewer: Viewer, id: string): Promise<Item | null> {
    if (!itemId.safeParse(id).success) return null;
    const [item] = await db.select().from(items).where(owned(viewer, id));
    return item ?? null;
  }

  return {
    async create(
      viewer: Viewer,
      input: unknown,
    ): Promise<Result<{ item: Item }, "invalid_input">> {
      const parsed = parseNewItem(input);
      if (!parsed.ok) return invalid(parsed.fields);
      const [item] = await db
        .insert(items)
        .values({ ...parsed.value, ownerId: viewer.userId })
        .returning();
      if (!item) throw new Error("insert item returned no row");
      return { ok: true, item };
    },

    get,

    // input is { limit?, cursor? }: limit 1 to 100 (20 when omitted), cursor a page's nextCursor.
    async list(
      viewer: Viewer,
      input: unknown,
    ): Promise<Result<ItemPage, "invalid_input">> {
      const parsed = parsePage(input);
      if (!parsed.ok) return invalid(parsed.fields);
      const { limit, cursor } = parsed.value;
      const after = cursor === undefined ? undefined : decodeCursor(cursor);
      if (after === null) return invalid({ cursor: "invalid" });
      // one row more than the page says whether another follows, without a count or a second query
      const rows = await db
        .select()
        .from(items)
        .where(
          and(
            eq(items.ownerId, viewer.userId),
            after === undefined ? undefined : lte(items.id, after),
          ),
        )
        .orderBy(desc(items.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        items: page,
        nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
      };
    },

    // input is a partial update: an omitted field stays, description: null clears it. An empty one changes
    // nothing, updated_at included. The input is checked before the id, as Go's contract validation runs first.
    async update(
      viewer: Viewer,
      id: string,
      input: unknown,
    ): Promise<Result<{ item: Item }, "invalid_input" | "not_found">> {
      const parsed = parseItemPatch(input);
      if (!parsed.ok) return invalid(parsed.fields);
      const patch = parsed.value;
      if (patch.title === undefined && patch.description === undefined) {
        const item = await get(viewer, id);
        return item ? { ok: true, item } : notFound;
      }
      if (!itemId.safeParse(id).success) return notFound;
      const [item] = await db
        .update(items)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(owned(viewer, id))
        .returning();
      return item ? { ok: true, item } : notFound;
    },

    async delete(
      viewer: Viewer,
      id: string,
    ): Promise<Result<object, "not_found">> {
      if (!itemId.safeParse(id).success) return notFound;
      const deleted = await db
        .delete(items)
        .where(owned(viewer, id))
        .returning({ id: items.id });
      return deleted.length > 0 ? { ok: true } : notFound;
    },
  };
}

// The queries over the app's pool, for server.ts and actions.ts. Made per call: they hold no state, and db() makes
// the pool on first use, so `next build` never connects.
export const queries = () => itemQueries(db());
