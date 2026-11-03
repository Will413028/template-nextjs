import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import {
  type FieldErrors,
  fieldErrors,
  signInInput,
  signUpInput,
} from "../credentials";
import { sessions, users } from "../schema";
import {
  createHasher,
  isCommonPassword,
  normalizePassword,
  type PasswordHasher,
} from "./password";
import { type Clock, SignInThrottle } from "./throttle";

// Accounts and opaque sessions, ported from template-go-nextjs modules/auth (ADR api-and-auth-baseline D4, D6;
// account-abuse-and-lifecycle D3, D4a). Cookies, actions and per-IP limits live in the action layer (step 2b).

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// last_used_at is written at most this often: enough for a 1-day idle limit, and reads do not write every time.
const TOUCH_EVERY = MINUTE;
// Deleting the account needs a session issued this recently: an operation that cannot be undone needs the password.
const REAUTHENTICATE_WITHIN = 10 * MINUTE;
// The settings page lists at most this many sessions, newest first.
const SESSION_LIST_LIMIT = 100;

declare const viewerBrand: unique symbol;

// Who is calling: made only by authenticate() from a live session, so a function that takes a Viewer cannot be
// called with an id the caller made up. Every query of user data takes it first and filters by userId (plan D8).
export type Viewer = {
  readonly userId: string;
  readonly username: string;
  readonly sessionId: string;
  readonly [viewerBrand]: true;
};

export type SessionInfo = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
};

// A new session: the token goes into the cookie and nowhere else.
export type Issued = { viewer: Viewer; token: string; maxAgeSeconds: number };

type Failure<Code extends string> = {
  ok: false;
  code: Code;
  fields?: FieldErrors;
  retryAfterSeconds?: number;
};
export type Result<T, Code extends string> = ({ ok: true } & T) | Failure<Code>;

// One line of JSON per security event (ADR account-abuse-and-lifecycle D2b). Never pass a password, a token or a
// submitted username that matched no account: it can be a password typed into the wrong field.
type SecurityLog = (event: string, fields: Record<string, string>) => void;

const stdoutLog: SecurityLog = (event, fields) => {
  console.info(
    JSON.stringify({ time: new Date().toISOString(), event, ...fields }),
  );
};

export type AuthServiceOptions = {
  db: Database;
  now?: Clock;
  hasher?: PasswordHasher;
  throttle?: SignInThrottle;
  log?: SecurityLog;
  sessionAbsoluteMs?: number;
  sessionIdleMs?: number;
};

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

const usernameKey = (username: string) => username.toLowerCase();

const sessionId = z.uuid();

export function createAuthService(options: AuthServiceOptions) {
  const db = options.db;
  const now = options.now ?? Date.now;
  const hasher = options.hasher ?? createHasher();
  const log = options.log ?? stdoutLog;
  const throttle =
    options.throttle ??
    new SignInThrottle(now, {
      onFull: (uncounted) =>
        log("auth.sign_in_throttle_full", { uncounted: String(uncounted) }),
    });
  const absoluteMs = options.sessionAbsoluteMs ?? 7 * DAY;
  const idleMs = options.sessionIdleMs ?? DAY;
  if (absoluteMs <= 0 || idleMs <= 0 || idleMs > absoluteMs) {
    throw new Error(
      "session lifetimes must be positive and idle must not exceed absolute",
    );
  }

  // Verified against when the username does not exist, so an unknown username costs the same hash as a wrong
  // password and the response time does not tell them apart.
  // Started with the service, so the first unknown username does not pay for making it; a failed one is made again
  // on the next use.
  let dummyHash: Promise<string> | undefined;
  const dummy = () => {
    if (!dummyHash) {
      const made = hasher.hash(randomUUID());
      dummyHash = made;
      made.catch(() => {
        if (dummyHash === made) dummyHash = undefined;
      });
    }
    return dummyHash;
  };
  dummy();

  const asViewer = (userId: string, username: string, id: string) =>
    ({ userId, username, sessionId: id }) as Viewer;

  // The live-session condition authenticate() applies, for the queries that list or revoke sessions.
  const live = (at: number) =>
    and(
      gt(sessions.expiresAt, new Date(at)),
      gt(sessions.lastUsedAt, new Date(at - idleMs)),
    );

  async function issue(
    tx: Pick<Database, "insert">,
    userId: string,
    username: string,
  ): Promise<Issued> {
    const at = new Date(now());
    const token = newToken();
    const [row] = await tx
      .insert(sessions)
      .values({
        tokenHash: hashToken(token),
        userId,
        createdAt: at,
        lastUsedAt: at,
        expiresAt: new Date(at.getTime() + absoluteMs),
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error("insert session returned no row");
    return {
      viewer: asViewer(userId, username, row.id),
      token,
      maxAgeSeconds: Math.floor(absoluteMs / 1000),
    };
  }

  return {
    // Creates the account and signs it in, in one transaction. The password is hashed before the transaction: it
    // takes tens of milliseconds and must not hold a connection.
    async signUp(
      input: unknown,
    ): Promise<
      Result<Issued, "invalid_input" | "password_too_common" | "username_taken">
    > {
      const parsed = signUpInput.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          fields: fieldErrors(parsed.error),
        };
      }
      const password = normalizePassword(parsed.data.password);
      if (isCommonPassword(password)) {
        return {
          ok: false,
          code: "password_too_common",
          fields: { password: "password_too_common" },
        };
      }
      const passwordHash = await hasher.hash(password);
      const username = usernameKey(parsed.data.username);
      const issued = await db.transaction(async (tx) => {
        // ON CONFLICT waits for a concurrent insert of the same username to commit, then inserts nothing
        const [user] = await tx
          .insert(users)
          .values({ username, passwordHash })
          .onConflictDoNothing({ target: users.username })
          .returning({ id: users.id });
        return user ? issue(tx, user.id, username) : null;
      });
      if (!issued) {
        return {
          ok: false,
          code: "username_taken",
          fields: { username: "username_taken" },
        };
      }
      log("auth.sign_up", { user_id: issued.viewer.userId });
      return { ok: true, ...issued };
    },

    // Checks the username and password and issues a new session; previousToken, the session the request carried,
    // is deleted, so a sign-in never keeps an old token valid (session fixation). The answer does not tell an
    // unknown username from a wrong password. source is the client's limitKey (client-ip.ts).
    async signIn(
      input: unknown,
      client: { source: string; previousToken?: string },
    ): Promise<
      Result<
        Issued,
        "invalid_input" | "invalid_credentials" | "login_throttled"
      >
    > {
      const parsed = signInInput.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          fields: fieldErrors(parsed.error),
        };
      }
      const username = usernameKey(parsed.data.username);
      const wait = throttle.reserve(username, client.source);
      if (wait > 0) {
        log("auth.sign_in_throttled", {});
        return {
          ok: false,
          code: "login_throttled",
          retryAfterSeconds: Math.ceil(wait / 1000),
        };
      }
      const password = normalizePassword(parsed.data.password);
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.username, username));
      if (!user) {
        await hasher.verify(password, await dummy());
        log("auth.sign_in_failed", { reason: "unknown_username" });
        return { ok: false, code: "invalid_credentials" };
      }
      if (!(await hasher.verify(password, user.passwordHash))) {
        log("auth.sign_in_failed", {
          reason: "invalid_credentials",
          user_id: user.id,
        });
        return { ok: false, code: "invalid_credentials" };
      }
      throttle.succeeded(username, client.source);
      const issued = await db.transaction(async (tx) => {
        if (client.previousToken) {
          await tx
            .delete(sessions)
            .where(eq(sessions.tokenHash, hashToken(client.previousToken)));
        }
        return issue(tx, user.id, username);
      });
      log("auth.sign_in", { user_id: user.id });
      return { ok: true, ...issued };
    },

    // The viewer of a session token, or null for a missing, unknown, expired or revoked one: the remedy is always to
    // sign in, so the reasons are not told apart.
    async authenticate(token: string | undefined): Promise<Viewer | null> {
      if (!token) return null;
      const tokenHash = hashToken(token);
      const [row] = await db
        .select({
          id: sessions.id,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          userId: users.id,
          username: users.username,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, tokenHash));
      const at = now();
      if (
        !row ||
        at >= row.expiresAt.getTime() ||
        at >= row.lastUsedAt.getTime() + idleMs
      ) {
        return null;
      }
      // a short idle limit (under two minutes) is touched more often, or a session in use would still lapse
      if (at - row.lastUsedAt.getTime() >= Math.min(TOUCH_EVERY, idleMs / 2)) {
        await db
          .update(sessions)
          .set({ lastUsedAt: new Date(at) })
          .where(eq(sessions.tokenHash, tokenHash));
      }
      return asViewer(row.userId, row.username, row.id);
    },

    // Deletes the token's session; an unknown or empty token is not an error.
    async signOut(token: string | undefined): Promise<void> {
      if (!token) return;
      const [row] = await db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)))
        .returning({ userId: sessions.userId });
      if (row) log("auth.sign_out", { user_id: row.userId });
    },

    async signOutEverywhere(viewer: Viewer): Promise<void> {
      await db.delete(sessions).where(eq(sessions.userId, viewer.userId));
      log("auth.sign_out_all", { user_id: viewer.userId });
    },

    // The viewer's live sessions, newest first (UUIDv7 ids sort by creation time).
    async listSessions(viewer: Viewer): Promise<SessionInfo[]> {
      const rows = await db
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(eq(sessions.userId, viewer.userId), live(now())))
        .orderBy(desc(sessions.id))
        .limit(SESSION_LIST_LIMIT);
      return rows.map((row) => ({
        ...row,
        current: row.id === viewer.sessionId,
      }));
    },

    // Revokes one of the viewer's live sessions. Another user's session is not found, the same as one that does not
    // exist.
    async revokeSession(
      viewer: Viewer,
      id: string,
    ): Promise<Result<object, "not_found">> {
      if (!sessionId.safeParse(id).success)
        return { ok: false, code: "not_found" };
      const deleted = await db
        .delete(sessions)
        .where(
          and(
            eq(sessions.id, id),
            eq(sessions.userId, viewer.userId),
            live(now()),
          ),
        )
        .returning({ id: sessions.id });
      if (deleted.length === 0) return { ok: false, code: "not_found" };
      log("auth.session_revoked", { user_id: viewer.userId, session_id: id });
      return { ok: true };
    },

    // Deletes the viewer's account and everything it owns (every foreign key to users cascades). The session the
    // request carries must have been issued within REAUTHENTICATE_WITHIN.
    async deleteAccount(
      viewer: Viewer,
    ): Promise<
      Result<object, "session_invalid" | "reauthentication_required">
    > {
      const [session] = await db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, viewer.sessionId),
            eq(sessions.userId, viewer.userId),
          ),
        );
      if (!session) return { ok: false, code: "session_invalid" };
      if (now() - session.createdAt.getTime() > REAUTHENTICATE_WITHIN) {
        return { ok: false, code: "reauthentication_required" };
      }
      await db.delete(users).where(eq(users.id, viewer.userId));
      log("auth.account_deleted", { user_id: viewer.userId });
      return { ok: true };
    },

    // Deletes expired sessions and forgets sign-in counts untouched for a day; the server runs it hourly (step 2b).
    async cleanup(): Promise<{ sessions: number; throttles: number }> {
      const at = now();
      const deleted = await db
        .delete(sessions)
        .where(
          or(
            lte(sessions.expiresAt, new Date(at)),
            lte(sessions.lastUsedAt, new Date(at - idleMs)),
          ),
        )
        .returning({ id: sessions.id });
      return { sessions: deleted.length, throttles: throttle.sweep() };
    },
  };
}
