import { randomBytes, randomUUIDv7 } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHasher } from "@/features/auth/server/password";
import { createAuthService, type Viewer } from "@/features/auth/server/service";
import { PAGE_SIZE } from "@/features/items/input";
import { type Item, itemQueries } from "@/features/items/server/queries";
import { createDatabase, type Database } from "@/server/db";
import { connectionFields } from "@/server/env";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

// The items queries against PostgreSQL as the app role, ported from template-go-nextjs httpapi/items_test.go
// (560106d). Viewers come from real sign-ups, the only way to get one. The actions and pages are tested in
// pages.test.ts and actions.test.ts.

let database: TestDatabase;
let db: Database;
let pool: pg.Pool;
let auth: ReturnType<typeof createAuthService>;
let items: ReturnType<typeof itemQueries>;

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  ({ db, pool } = createDatabase({
    ...connectionFields(database.url(APP)),
    password: database.appPassword,
    maxConnections: 10,
    statementTimeoutMs: 5000,
  }));
  auth = createAuthService({
    db,
    // cheap argon2 keeps the sign-ups fast
    hasher: createHasher({ params: { memoryKiB: 64, time: 1, threads: 1 } }),
    log: () => {},
  });
  items = itemQueries(db);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await database?.stop();
});

// Test order is random and the database is shared, so every test signs up its own users.
async function signUp(): Promise<Viewer> {
  const username = `user-${randomBytes(4).toString("hex")}`;
  const result = await auth.signUp({
    username,
    password: "a long enough password",
  });
  if (!result.ok) throw new Error(`sign up ${username}: ${result.code}`);
  return result.viewer;
}

async function create(
  viewer: Viewer,
  title: string,
  description?: string,
): Promise<Item> {
  const result = await items.create(viewer, { title, description });
  if (!result.ok) throw new Error(`create ${title}: ${result.code}`);
  return result.item;
}

async function update(
  viewer: Viewer,
  id: string,
  patch: object,
): Promise<Item> {
  const result = await items.update(viewer, id, patch);
  if (!result.ok) throw new Error(`update ${id}: ${result.code}`);
  return result.item;
}

async function list(viewer: Viewer, input: object = {}) {
  const result = await items.list(viewer, input);
  if (!result.ok) throw new Error(`list: ${result.code}`);
  return result;
}

const invalid = (fields: object) => ({
  ok: false,
  code: "invalid_input",
  fields,
});
const notFound = { ok: false, code: "not_found" };

describe("creating an item", () => {
  it("makes it the viewer's, readable by its id, with a missing description as null", async () => {
    const alice = await signUp();
    const result = await items.create(alice, {
      title: "Buy milk",
      description: "two litres",
    });
    expect(result).toMatchObject({
      ok: true,
      item: {
        title: "Buy milk",
        description: "two litres",
        ownerId: alice.userId,
      },
    });
    if (!result.ok) return;
    expect(await items.get(alice, result.item.id)).toEqual(result.item);
    expect((await create(alice, "No description")).description).toBeNull();
  });

  it("takes titles of 1 to 200 code points, and the database refuses any other", async () => {
    const alice = await signUp();
    expect(await items.create(alice, { title: "a".repeat(201) })).toEqual(
      invalid({ title: "too_long" }),
    );
    expect(await items.create(alice, { title: "" })).toEqual(
      invalid({ title: "too_short" }),
    );
    expect(await items.create(alice, { description: "no title" })).toEqual(
      invalid({ title: "required" }),
    );
    // 200 multi-byte characters are 600 bytes but 200 code points: accepted by both layers
    expect([...(await create(alice, "字".repeat(200))).title]).toHaveLength(
      200,
    );
    for (const title of ["a".repeat(201), ""]) {
      await expect(
        pool.query("INSERT INTO items (title, owner_id) VALUES ($1, $2)", [
          title,
          alice.userId,
        ]),
      ).rejects.toThrow(/items_title_check/);
    }
  });
});

describe("text PostgreSQL cannot hold", () => {
  // PostgreSQL text refuses U+0000 (SQLSTATE 22021): the rules name the field instead of the insert throwing
  it("is refused as invalid in a title or a description, not passed to the database", async () => {
    const alice = await signUp();
    expect(await items.create(alice, { title: "a\u0000b" })).toEqual(
      invalid({ title: "invalid" }),
    );
    const item = await create(alice, "fine");
    expect(
      await items.update(alice, item.id, { description: "a\u0000b" }),
    ).toEqual(invalid({ description: "invalid" }));
    expect(await items.get(alice, item.id)).toEqual(item);
  });
});

describe("listing items", () => {
  it("reads a page, and says whether another follows, in one query", async () => {
    const viewer = await signUp();
    for (let i = 0; i < PAGE_SIZE + 1; i++) await create(viewer, `item ${i}`);
    // every statement drizzle sends goes through the pool's query; one per page, never one per item (N+1)
    const queries = vi.spyOn(pool, "query");
    try {
      const first = await list(viewer);
      expect(first.items).toHaveLength(PAGE_SIZE);
      expect(queries).toHaveBeenCalledTimes(1);
      await list(viewer, { cursor: first.nextCursor });
      expect(queries).toHaveBeenCalledTimes(2);
    } finally {
      queries.mockRestore();
    }
  });

  it("shows only the viewer's, newest first, with no next cursor on the only page", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const first = await create(alice, "first");
    const second = await create(alice, "second");
    await create(bob, "bob's");
    const page = await list(alice);
    expect(page.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(page.nextCursor).toBeNull();
    // a user without items gets an empty page
    expect(await items.list(await signUp(), {})).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
    });
  });

  // Keyset pagination ordered by id: items created while a client pages through do not shift later pages, so
  // nothing is returned twice or skipped.
  it("pages through with a keyset cursor: an item created meanwhile neither repeats nor skips one", async () => {
    const alice = await signUp();
    const want: string[] = []; // newest first
    for (let i = 0; i < 5; i++) {
      want.unshift((await create(alice, `item ${i}`)).id);
    }
    const got: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; ; pages++) {
      if (pages > 5) throw new Error("pagination did not end");
      const page = await list(alice, { limit: 2, cursor });
      expect(page.items.length).toBeLessThanOrEqual(2);
      got.push(...page.items.map((item) => item.id));
      if (pages === 0) await create(alice, "created while paging");
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(got).toEqual(want);
  });

  it(`has ${PAGE_SIZE} items a page when the caller names no limit`, async () => {
    const alice = await signUp();
    await pool.query(
      "INSERT INTO items (title, owner_id) SELECT 'item ' || n, $1 FROM generate_series(1, $2::int) AS n",
      [alice.userId, PAGE_SIZE + 1],
    );
    const page = await list(alice);
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
  });

  it("refuses a limit outside 1 to 100 and a cursor it did not make", async () => {
    const alice = await signUp();
    expect(await items.list(alice, { limit: 101 })).toEqual(
      invalid({ limit: "out_of_range" }),
    );
    for (const cursor of ["not-a-cursor", ""]) {
      expect(await items.list(alice, { cursor })).toEqual(
        invalid({ cursor: "invalid" }),
      );
    }
  });
});

describe("reading an item", () => {
  it("finds the viewer's item, and not one that does not exist or whose id is no UUID", async () => {
    const alice = await signUp();
    const item = await create(alice, "mine");
    expect(await items.get(alice, item.id)).toEqual(item);
    expect(await items.get(alice, randomUUIDv7())).toBeNull();
    expect(await items.get(alice, "42")).toBeNull();
  });

  // Regression (template-go-nextjs's old backend let anyone read any item): another user's item is not found,
  // exactly like one that does not exist.
  it("does not find another user's item", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const item = await create(alice, "alice's");
    expect(await items.get(bob, item.id)).toBeNull();
    expect(await items.get(alice, item.id)).toEqual(item);
  });
});

describe("changing an item", () => {
  it("sets the title and description and keeps its id and created_at", async () => {
    const alice = await signUp();
    const item = await create(alice, "old");
    const got = await update(alice, item.id, {
      title: "new",
      description: "details",
    });
    expect(got).toMatchObject({
      id: item.id,
      title: "new",
      description: "details",
      createdAt: item.createdAt,
    });
    expect(await items.get(alice, item.id)).toEqual(got);
    expect(await items.update(alice, randomUUIDv7(), { title: "x" })).toEqual(
      notFound,
    );
  });

  // Go's JSON Merge Patch (RFC 7396): omitted fields stay, description: null clears, title: null is refused.
  it("changes only the fields it is given: description null clears it, title null is refused", async () => {
    const alice = await signUp();
    const item = await create(alice, "title", "keep me");
    expect(await update(alice, item.id, { title: "renamed" })).toMatchObject({
      title: "renamed",
      description: "keep me",
    });
    expect(
      await update(alice, item.id, { description: "changed" }),
    ).toMatchObject({ title: "renamed", description: "changed" });
    const cleared = await update(alice, item.id, { description: null });
    expect(cleared).toMatchObject({ title: "renamed", description: null });
    // an empty change leaves the item as it was, updated_at included
    expect(await update(alice, item.id, {})).toEqual(cleared);
    expect(await items.update(alice, item.id, { title: null })).toEqual(
      invalid({ title: "null_not_allowed" }),
    );
    expect(await items.get(alice, item.id)).toEqual(cleared);
  });

  // updated_at is set by the update query itself, not by the caller or a trigger.
  it("moves updated_at on a change and leaves created_at", async () => {
    const alice = await signUp();
    const item = await create(alice, "title");
    expect(item.updatedAt).toEqual(item.createdAt);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const got = await update(alice, item.id, { title: "changed" });
    expect(got.updatedAt.getTime()).toBeGreaterThan(item.updatedAt.getTime());
    expect(got.createdAt).toEqual(item.createdAt);
  });

  it("does not change another user's item", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const item = await create(alice, "alice's");
    expect(await items.update(bob, item.id, { title: "bob was here" })).toEqual(
      notFound,
    );
    expect(await items.get(alice, item.id)).toEqual(item);
  });
});

describe("deleting an item", () => {
  it("removes the viewer's item, which is then not found", async () => {
    const alice = await signUp();
    const item = await create(alice, "doomed");
    expect(await items.delete(alice, item.id)).toEqual({ ok: true });
    expect(await items.get(alice, item.id)).toBeNull();
    expect(await items.delete(alice, item.id)).toEqual(notFound);
    expect(await items.delete(alice, "42")).toEqual(notFound);
  });

  it("does not delete another user's item", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const item = await create(alice, "alice's");
    expect(await items.delete(bob, item.id)).toEqual(notFound);
    expect(await items.get(alice, item.id)).toEqual(item);
  });

  it("goes with the account that owns it", async () => {
    const alice = await signUp();
    const item = await create(alice, "goes with alice");
    expect(await auth.deleteAccount(alice)).toEqual({ ok: true });
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM items WHERE id = $1",
      [item.id],
    );
    expect(rows[0]?.n).toBe(0);
  });
});
