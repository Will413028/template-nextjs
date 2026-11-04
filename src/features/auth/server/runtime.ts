import "server-only";
import { cookies } from "next/headers";
import { limitKey } from "@/server/client-ip";
import { db } from "@/server/db";
import { authConfig } from "@/server/env";
import { requestClientIP, trustedProxies } from "@/server/request";
import { createAuthService } from "./service";
import { IPLimiter } from "./throttle";

// The process's auth state: the service and the per-IP limiter, made on first use so that
// `next build` reads no configuration and opens no connection. Kept on globalThis: Next.js may bundle this module
// into more than one server chunk, and two copies would each keep their own limits.

const SESSION_COOKIE = "__Host-session";

const HOUR = 60 * 60_000;

type Runtime = {
  service: ReturnType<typeof createAuthService>;
  limiter: IPLimiter;
};

const KEY = Symbol.for("features.auth.runtime");
const store = globalThis as unknown as Record<symbol, Runtime | undefined>;
function create(): Runtime {
  // Configuration first: a bad value throws before anything starts, so a retry leaves nothing behind.
  const config = authConfig();
  // not used here: read so a bad TRUSTED_PROXIES fails before the timer starts too where register() did not run first
  // (instrumentation.ts), such as a test that imports this module
  trustedProxies();
  const limiter = new IPLimiter(config.rateLimitPerMinute, Date.now);
  const service = createAuthService({ db: db() });
  // Expired sessions and day-old sign-in counts; unref, so the timer never keeps the process up.
  setInterval(() => {
    service
      .cleanup()
      .then((removed) =>
        console.info(JSON.stringify({ event: "auth.cleanup", ...removed })),
      )
      .catch((error) => console.error("auth cleanup failed", error));
  }, HOUR).unref();
  return { service, limiter };
}

function runtime(): Runtime {
  store[KEY] ??= create();
  return store[KEY];
}

export const authService = () => runtime().service;

// The client's limitKey (src/server/request.ts): actions Next.js forwards to itself over loopback share one key,
// which only limits them harder.
export async function clientSource(): Promise<string> {
  return limitKey(await requestClientIP());
}

// 0 when the request may go ahead, else the milliseconds until it may.
export const takeRateLimit = (source: string) => runtime().limiter.take(source);

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value || undefined;
}

// ADR api-and-auth D4: __Host- (Secure, Path=/, no Domain), HttpOnly, SameSite=Lax.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export async function setSessionCookie(
  token: string,
  maxAgeSeconds: number,
): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    ...cookieOptions,
    maxAge: maxAgeSeconds,
  });
}

// A browser ignores a __Host- cookie without Secure and Path=/, a deletion included, so this sets the same
// attributes with Max-Age=0 instead of calling cookies().delete().
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
