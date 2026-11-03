import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import { authConfig } from "@/server/env";
import { clientIP, limitKey, type Prefix, parsePrefix } from "./client-ip";
import { createAuthService } from "./service";
import { IPLimiter } from "./throttle";

// The process's auth state: the service, the per-IP limiter and the trusted proxies, made on first use so that
// `next build` reads no configuration and opens no connection. Kept on globalThis: Next.js may bundle this module
// into more than one server chunk, and two copies would each keep their own limits.

const SESSION_COOKIE = "__Host-session";

// Written by peer.cjs, the preload that records the TCP peer before Next.js runs (plan D2 deviation 3); it overwrites
// any value a client sends. peer.test.ts checks the two names match.
export const PEER_HEADER = "x-peer-address";

const HOUR = 60 * 60_000;

type Runtime = {
  service: ReturnType<typeof createAuthService>;
  limiter: IPLimiter;
  trusted: Prefix[];
};

const KEY = Symbol.for("features.auth.runtime");
const store = globalThis as unknown as Record<symbol, Runtime | undefined>;

function create(): Runtime {
  const config = authConfig();
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
  return {
    service,
    limiter: new IPLimiter(config.rateLimitPerMinute, Date.now),
    // a bad prefix throws here, on the first request that needs it
    trusted: config.trustedProxies.map(parsePrefix),
  };
}

function runtime(): Runtime {
  store[KEY] ??= create();
  return store[KEY];
}

export const authService = () => runtime().service;

// The client's limitKey: the TCP peer, or behind a trusted proxy the address it forwarded (client-ip.ts).
export async function clientSource(): Promise<string> {
  const h = await headers();
  const peer = h.get(PEER_HEADER);
  const ip = peer
    ? clientIP(peer, [h.get("x-forwarded-for") ?? ""], runtime().trusted)
    : null;
  if (!ip) {
    // without the preload every client would share one key, or pick its own through X-Forwarded-For
    throw new Error(
      `${PEER_HEADER} is missing: start Node.js with --require ./peer.cjs`,
    );
  }
  return limitKey(ip);
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
