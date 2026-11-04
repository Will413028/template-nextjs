import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions, users } from "@/features/auth/schema";
import {
  createHasher,
  type PasswordHasher,
} from "@/features/auth/server/password";
import {
  type AuthServiceOptions,
  createAuthService,
  type Viewer,
} from "@/features/auth/server/service";
import { createDatabase, type Database } from "@/server/db";
import { connectionFields } from "@/server/env";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

// The auth service against PostgreSQL as the app role, ported from template-go-nextjs httpapi/auth_test.go,
// auth_resources_test.go, throttle_test.go and modules/auth/service_test.go, schema_test.go. Cookies, actions and
// per-IP limits are step 2b.

let database: TestDatabase;
let db: Database;
let pool: pg.Pool;

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  ({ db, pool } = createDatabase({
    ...connectionFields(database.url(APP)),
    password: database.appPassword,
    maxConnections: 20,
    statementTimeoutMs: 5000,
  }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await database?.stop();
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PASSWORD = "a long enough password";
const SOURCE = "192.0.2.1";

// Test order is random and the database is shared, so every test uses its own usernames.
const name = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

// Cheap argon2 keeps the tests fast; verifies counts password checks.
function countingHasher(delayMs = 0) {
  const inner = createHasher({
    params: { memoryKiB: 64, time: 1, threads: 1 },
  });
  const counts = { verifies: 0 };
  const hasher: PasswordHasher = {
    hash: (password) => inner.hash(password),
    verify: async (password, encoded) => {
      counts.verifies++;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return inner.verify(password, encoded);
    },
  };
  return { hasher, counts };
}

function setup(
  options: Partial<AuthServiceOptions> & { delayMs?: number } = {},
) {
  let at = Date.UTC(2026, 10, 3, 12);
  const { hasher, counts } = countingHasher(options.delayMs);
  const logs: { event: string; fields: Record<string, string> }[] = [];
  const auth = createAuthService({
    db,
    now: () => at,
    hasher,
    log: (event, fields) => logs.push({ event, fields }),
    ...options,
  });
  const advance = (ms: number) => {
    at += ms;
  };
  async function signUp(username = name("user"), password = PASSWORD) {
    const result = await auth.signUp({ username, password });
    if (!result.ok) throw new Error(`sign up ${username}: ${result.code}`);
    return result;
  }
  async function signIn(username: string, password = PASSWORD) {
    const result = await auth.signIn(
      { username, password },
      { source: SOURCE },
    );
    if (!result.ok) throw new Error(`sign in ${username}: ${result.code}`);
    return result;
  }
  return { auth, advance, counts, logs, signUp, signIn };
}

function sessionRows(userId: string) {
  return db
    .select({ tokenHash: sessions.tokenHash, id: sessions.id })
    .from(sessions)
    .where(sql`${sessions.userId} = ${userId}`);
}

describe("sign-up", () => {
  it("creates a lowercase user, signs it in and stores only the token's SHA-256", async () => {
    const { signUp } = setup();
    const username = name("Alice");
    const { viewer, token, maxAgeSeconds } = await signUp(username);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(maxAgeSeconds).toBe(7 * 24 * 3600);
    expect(viewer.username).toBe(username.toLowerCase());
    const [user] = await db
      .select({ username: users.username, hash: users.passwordHash })
      .from(users)
      .where(sql`${users.id} = ${viewer.userId}`);
    expect(user?.username).toBe(username.toLowerCase());
    expect(user?.hash.startsWith("$argon2id$")).toBe(true);
    const rows = await sessionRows(viewer.userId);
    expect(rows).toHaveLength(1);
    expect(
      rows[0]?.tokenHash.equals(createHash("sha256").update(token).digest()),
    ).toBe(true);
  });

  it("refuses a username that differs only in case", async () => {
    const { auth, signUp } = setup();
    const username = name("bob");
    await signUp(username);
    const again = await auth.signUp({
      username: username.toUpperCase(),
      password: PASSWORD,
    });
    expect(again).toMatchObject({
      ok: false,
      code: "username_taken",
      fields: { username: "username_taken" },
    });
  });

  it("lets exactly one of ten concurrent sign-ups of the same username through", async () => {
    const { auth } = setup();
    const username = name("race");
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        auth.signUp({ username, password: PASSWORD }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && r.code === "username_taken"),
    ).toHaveLength(9);
  });

  it("rejects a password on the common-password list and a too-short one", async () => {
    const { auth } = setup();
    expect(
      await auth.signUp({ username: name("c"), password: "demon1q2w3e4r5t" }),
    ).toMatchObject({
      ok: false,
      code: "password_too_common",
      fields: { password: "password_too_common" },
    });
    expect(
      await auth.signUp({ username: name("c"), password: "fourteen chars" }),
    ).toMatchObject({
      ok: false,
      code: "invalid_input",
      fields: { password: "too_short" },
    });
  });
});

describe("sign-in", () => {
  it("signs in with the right password, case-insensitively, and refuses a wrong one", async () => {
    const { auth, signUp } = setup();
    const username = name("carol");
    await signUp(username);
    const ok = await auth.signIn(
      { username: username.toUpperCase(), password: PASSWORD },
      { source: SOURCE },
    );
    expect(ok.ok && ok.viewer.username).toBe(username);
    expect(
      await auth.signIn(
        { username, password: "not the password" },
        { source: SOURCE },
      ),
    ).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
  });

  it("checks one hash for an unknown username and answers the same as for a wrong password", async () => {
    const { auth, signUp, counts } = setup();
    const username = name("dave");
    await signUp(username);
    const wrong = await auth.signIn(
      { username, password: "not the password" },
      { source: SOURCE },
    );
    counts.verifies = 0;
    const unknown = await auth.signIn(
      { username: name("nobody"), password: "not the password" },
      { source: SOURCE },
    );
    expect(counts.verifies).toBe(1);
    expect(unknown).toEqual(wrong);
  });

  it("makes the unknown-username hash again after it once failed", async () => {
    const inner = createHasher({
      params: { memoryKiB: 64, time: 1, threads: 1 },
    });
    let failNext = true;
    const { auth } = setup({
      hasher: {
        hash: (password) => {
          if (failNext) {
            failNext = false;
            return Promise.reject(new Error("out of memory"));
          }
          return inner.hash(password);
        },
        verify: (password, encoded) => inner.verify(password, encoded),
      },
    });
    // the service made its dummy hash on creation, and that one failed
    expect(failNext).toBe(false);
    expect(
      await auth.signIn(
        { username: name("nobody"), password: "not the password" },
        { source: SOURCE },
      ),
    ).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("issues a new token on every sign-in and ends the session the request carried", async () => {
    const { auth, signUp } = setup();
    const username = name("erin");
    const first = await signUp(username);
    const second = await auth.signIn(
      { username, password: PASSWORD },
      { source: SOURCE, previousToken: first.token },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.token).not.toBe(first.token);
    expect(await auth.authenticate(first.token)).toBeNull();
    expect(await auth.authenticate(second.token)).not.toBeNull();
    expect(await sessionRows(first.viewer.userId)).toHaveLength(1);
  });

  it("treats full-width and half-width passwords as the same (NFKC)", async () => {
    const { signUp, signIn } = setup();
    const alice = name("nfkc");
    await signUp(alice, "ｃｏｒｒｅｃｔ－ｈｏｒｓｅ－ｂａｔｔｅｒｙ");
    await signIn(alice, "correct-horse-battery");
    const bob = name("nfkc");
    await signUp(bob, "correct-horse-battery-staple");
    await signIn(
      bob,
      "ｃｏｒｒｅｃｔ－ｈｏｒｓｅ－ｂａｔｔｅｒｙ－ｓｔａｐｌｅ",
    );
  });
});

describe("sign-in throttling", () => {
  it("logs a sign-in it could not count because every count is in its backoff", async () => {
    const { auth, logs } = setup({ throttleMaxEntries: 1 });
    const attempt = (username: string, source: string) =>
      auth.signIn({ username, password: "not the password" }, { source });
    const first = name("full");
    for (let i = 0; i < 5; i++) await attempt(first, SOURCE);
    // the one slot holds a pair in its backoff, which is never evicted: a new pair goes ahead uncounted
    expect(await attempt(name("other"), "192.0.2.2")).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
    expect(
      logs.filter((line) => line.event === "auth.sign_in_throttle_full"),
    ).toEqual([
      { event: "auth.sign_in_throttle_full", fields: { uncounted: "1" } },
    ]);
  });

  it("throttles a username from one source after five failures, not the owner elsewhere", async () => {
    const { auth, signUp, advance } = setup();
    const username = name("frank");
    await signUp(username);
    const attempt = (source: string, password = "not the password") =>
      auth.signIn({ username, password }, { source });
    for (let i = 0; i < 5; i++) {
      expect(await attempt(SOURCE)).toMatchObject({
        code: "invalid_credentials",
      });
    }
    expect(await attempt(SOURCE, PASSWORD)).toEqual({
      ok: false,
      code: "login_throttled",
      retryAfterSeconds: 60,
    });
    // an unknown username is throttled the same way, so the answer does not tell whether it exists
    const unknown = name("nobody");
    for (let i = 0; i < 5; i++) {
      await auth.signIn(
        { username: unknown, password: "x" },
        { source: SOURCE },
      );
    }
    expect(
      await auth.signIn(
        { username: unknown, password: "x" },
        { source: SOURCE },
      ),
    ).toEqual({ ok: false, code: "login_throttled", retryAfterSeconds: 60 });
    // another client is not locked out by these failures
    expect((await attempt("198.51.100.7", PASSWORD)).ok).toBe(true);
    // which does not reset this source's backoff; once its wait has passed, its own sign-in goes through
    expect(await attempt(SOURCE, PASSWORD)).toMatchObject({
      code: "login_throttled",
    });
    advance(MINUTE);
    expect((await attempt(SOURCE, PASSWORD)).ok).toBe(true);
  });

  it("checks five passwords out of twenty concurrent attempts and throttles the rest", async () => {
    const { auth, signUp, counts } = setup({ delayMs: 50 });
    const username = name("grace");
    await signUp(username);
    counts.verifies = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        auth.signIn(
          { username, password: "not the password" },
          { source: SOURCE },
        ),
      ),
    );
    const codes = results.map((r) => (r.ok ? "ok" : r.code));
    expect(codes.filter((c) => c === "invalid_credentials")).toHaveLength(5);
    expect(codes.filter((c) => c === "login_throttled")).toHaveLength(15);
    expect(counts.verifies).toBe(5);
  });
});

describe("sessions", () => {
  it("authenticates a live token and nothing else", async () => {
    const { auth, signUp } = setup();
    const { viewer, token } = await signUp();
    const seen = await auth.authenticate(token);
    expect(seen).toEqual(viewer);
    // UUIDv7 ids
    expect(seen?.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await auth.authenticate(undefined)).toBeNull();
    expect(await auth.authenticate("")).toBeNull();
    expect(
      await auth.authenticate(randomBytes(32).toString("base64url")),
    ).toBeNull();
  });

  it("ends a session idle for a day and one older than seven days", async () => {
    const { auth, signUp, advance } = setup();
    const idle = await signUp();
    advance(DAY - 1);
    expect(await auth.authenticate(idle.token)).not.toBeNull();
    advance(DAY);
    expect(await auth.authenticate(idle.token)).toBeNull();

    // used every 12 hours, so never idle for long: only the 7-day limit ends it
    const used = await signUp();
    for (let i = 0; i < 13; i++) {
      advance(DAY / 2);
      expect(await auth.authenticate(used.token)).not.toBeNull();
    }
    advance(DAY / 2);
    expect(await auth.authenticate(used.token)).toBeNull();
  });

  it("neither lists nor revokes a session past its 7-day limit", async () => {
    const { auth, signUp, signIn, advance } = setup();
    const username = name("absolute");
    const old = await signUp(username);
    for (let i = 0; i < 13; i++) {
      advance(DAY / 2);
      await auth.authenticate(old.token);
    }
    const current = await signIn(username);
    advance(DAY / 2);
    // old is 7 days old and was used 12 hours ago; only its absolute limit has passed
    expect((await auth.listSessions(current.viewer)).map((s) => s.id)).toEqual([
      current.viewer.sessionId,
    ]);
    expect(
      await auth.revokeSession(current.viewer, old.viewer.sessionId),
    ).toEqual({ ok: false, code: "not_found" });
  });

  it("keeps a session used every 20 seconds alive under a 30-second idle limit", async () => {
    const { auth, signUp, advance } = setup({
      sessionAbsoluteMs: 60 * MINUTE,
      sessionIdleMs: 30_000,
    });
    const { token } = await signUp();
    for (let i = 0; i < 4; i++) {
      advance(20_000);
      expect(await auth.authenticate(token)).not.toBeNull();
    }
  });

  it("signs out the current session and, everywhere, all of them", async () => {
    const { auth, signUp, signIn } = setup();
    const username = name("heidi");
    const first = await signUp(username);
    const second = await signIn(username);
    await auth.signOut(first.token);
    expect(await auth.authenticate(first.token)).toBeNull();
    expect(await auth.authenticate(second.token)).not.toBeNull();
    await auth.signOut(undefined);
    const third = await signIn(username);
    await auth.signOutEverywhere(third.viewer);
    expect(await auth.authenticate(second.token)).toBeNull();
    expect(await auth.authenticate(third.token)).toBeNull();
  });

  it("lists the viewer's live sessions newest first and marks the current one", async () => {
    const { auth, signUp, signIn, advance } = setup();
    const username = name("ivan");
    const old = await signUp(username);
    advance(2 * DAY);
    const a = await signIn(username);
    advance(MINUTE);
    const b = await signIn(username);
    await signUp(); // someone else's
    const list = await auth.listSessions(b.viewer);
    // the first session has been idle for two days
    expect(list.map((s) => s.id)).toEqual([
      b.viewer.sessionId,
      a.viewer.sessionId,
    ]);
    expect(list.map((s) => s.current)).toEqual([true, false]);
    expect(list.map((s) => s.id)).not.toContain(old.viewer.sessionId);
    const [newest] = list;
    expect(newest?.expiresAt.getTime()).toBe(
      (newest?.createdAt.getTime() ?? 0) + 7 * DAY,
    );
  });

  it("revokes the viewer's own session but not another user's", async () => {
    const { auth, signUp, signIn } = setup();
    const username = name("judy");
    const mine = await signUp(username);
    const other = await signIn(username);
    const stranger = await signUp();
    expect(
      await auth.revokeSession(stranger.viewer, other.viewer.sessionId),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await auth.authenticate(other.token)).not.toBeNull();
    expect(
      await auth.revokeSession(mine.viewer, other.viewer.sessionId),
    ).toEqual({ ok: true });
    expect(await auth.authenticate(other.token)).toBeNull();
    expect(
      await auth.revokeSession(mine.viewer, other.viewer.sessionId),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await auth.revokeSession(mine.viewer, "not-a-uuid")).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("cleans up expired sessions and day-old sign-in counts", async () => {
    const { auth, signUp, advance } = setup();
    // other tests' rows share the table, so count only this test's
    const idle = await signUp();
    await auth.signIn(
      { username: name("ghost"), password: "wrong password" },
      { source: SOURCE },
    );
    advance(25 * 60 * MINUTE);
    const fresh = await signUp();
    const counts = await auth.cleanup();
    expect(counts.throttles).toBe(1);
    expect(counts.sessions).toBeGreaterThanOrEqual(1);
    expect(await sessionRows(idle.viewer.userId)).toHaveLength(0);
    expect(await sessionRows(fresh.viewer.userId)).toHaveLength(1);
  });
});

describe("deleting the account", () => {
  it("deletes the user and its sessions within ten minutes of signing in, and asks to sign in again after", async () => {
    const { auth, signUp, signIn, advance } = setup();
    const username = name("ken");
    const created = await signUp(username);
    advance(11 * MINUTE);
    const stale = await auth.authenticate(created.token);
    expect(await auth.deleteAccount(stale as Viewer)).toEqual({
      ok: false,
      code: "reauthentication_required",
    });

    const fresh = await signIn(username);
    advance(9 * MINUTE);
    expect(await auth.deleteAccount(fresh.viewer)).toEqual({ ok: true });
    expect(await auth.authenticate(created.token)).toBeNull();
    expect(await auth.authenticate(fresh.token)).toBeNull();
    expect(await sessionRows(fresh.viewer.userId)).toHaveLength(0);
    expect(
      (
        await auth.signIn(
          { username, password: PASSWORD },
          { source: "198.51.100.8" },
        )
      ).ok,
    ).toBe(false);
  });
});

describe("security events", () => {
  it("logs sign-up, sign-in, failures and sign-out with user ids, never the password, token or unknown username", async () => {
    const { auth, signUp, logs } = setup();
    const canary = `canary ${randomBytes(6).toString("hex")} phrase`;
    const username = name("log");
    const created = await signUp(username, canary);
    await auth.signIn(
      { username, password: `${canary} wrong` },
      { source: SOURCE },
    );
    const unknown = name("nobody");
    await auth.signIn(
      { username: unknown, password: canary },
      { source: SOURCE },
    );
    const signedIn = await auth.signIn(
      { username, password: canary },
      { source: SOURCE },
    );
    if (!signedIn.ok) throw new Error(signedIn.code);
    await auth.signOut(signedIn.token);

    const id = created.viewer.userId;
    expect(logs).toEqual([
      { event: "auth.sign_up", fields: { user_id: id } },
      {
        event: "auth.sign_in_failed",
        fields: { reason: "invalid_credentials", user_id: id },
      },
      { event: "auth.sign_in_failed", fields: { reason: "unknown_username" } },
      { event: "auth.sign_in", fields: { user_id: id } },
      { event: "auth.sign_out", fields: { user_id: id } },
    ]);
    const text = JSON.stringify(logs);
    for (const secret of [canary, created.token, signedIn.token, unknown]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("schema", () => {
  it("rejects an uppercase or too-short username and a token hash that is not 32 bytes", async () => {
    const insertUser = (username: string) =>
      db.insert(users).values({ username, passwordHash: "x" });
    await expect(insertUser(name("Upper"))).rejects.toThrow();
    await expect(insertUser("ab")).rejects.toThrow();
    const [user] = await db
      .insert(users)
      .values({ username: name("schema"), passwordHash: "x" })
      .returning({ id: users.id });
    if (!user) throw new Error("insert returned no row");
    const now = new Date();
    await expect(
      db.insert(sessions).values({
        tokenHash: randomBytes(31),
        userId: user.id,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now,
      }),
    ).rejects.toThrow();
  });

  it("lets every foreign key to users follow a deleted account (cascade or set null)", async () => {
    const { rows } = await pool.query<{ name: string; action: string }>(
      `SELECT conname AS name, confdeltype AS action FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'public.users'::regclass`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["c", "n"], row.name).toContain(row.action);
    }
  });
});
