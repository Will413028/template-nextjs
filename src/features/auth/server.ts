import "server-only";
import { randomUUIDv7 } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { withRequestId } from "./server/log";
import {
  authService,
  clearSessionCookie,
  clientSource,
  fromTrustedProxy,
  sessionToken,
  takeRateLimit,
} from "./server/runtime";
import type { Viewer } from "./server/service";

// The auth feature's server boundary for the rest of the app (plan D8): every Server Action is made with authedAction
// or publicAction (src/__tests__/server-actions.test.ts), and every page or query of user data starts from a Viewer,
// which only a live session yields.

export type { Viewer };

export type Unauthenticated = { ok: false; code: "unauthenticated" };
export type RateLimited = {
  ok: false;
  code: "rate_limited";
  retryAfterSeconds: number;
};

// The request's viewer, or null. Only the __Host-session cookie counts: an Authorization header is never read.
// Cached per render, so a layout and its page share one lookup.
const currentViewer = cache(
  async (): Promise<Viewer | null> =>
    authService().authenticate(await sessionToken()),
);

// For pages and layouts (server components): the viewer, or a redirect to sign in. A component cannot write cookies
// while it renders, so a dead cookie goes through the Route Handler that clears it (plan D2 deviation 5, D3).
export async function requireSession(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (viewer) return viewer;
  const locale = await getLocale();
  redirect(
    (await sessionToken())
      ? `/api/session/expired?locale=${encodeURIComponent(locale)}`
      : `/${locale}/sign-in`,
  );
}

// A request id a proxy may set: it goes into log lines and a response header (Go middleware.go validRequestID).
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

// For proxy.ts, once per request (Go middleware.go withRequestInfo): the id a trusted proxy sent, when well formed,
// or a new UUIDv7. TRUSTED_PROXIES is read on every request, an id or not: a value that does not parse fails every
// response, the health check's included, where Go refuses to start. An action Next.js forwards to itself over
// loopback (runtime.ts clientSource) gets a new id here, so its log lines do not carry the id its client received;
// the app's own forms are never forwarded.
export function requestIdFor(headers: Headers): string {
  const trusted = fromTrustedProxy(headers);
  const sent = headers.get(REQUEST_ID_HEADER);
  return trusted && sent && VALID_REQUEST_ID.test(sent) ? sent : randomUUIDv7();
}

// Runs an action with its request's id (set by proxy.ts) on every security event it logs.
async function inRequest<T>(run: () => Promise<T>): Promise<T> {
  return withRequestId((await headers()).get(REQUEST_ID_HEADER), run);
}

// A Server Action that needs a signed-in user. The session is checked before the action reads its arguments, so an
// unauthenticated caller learns nothing from validation (Go TestUnauthenticatedBeforeValidation), and a dead cookie
// is cleared on the way out (Go TestInvalidSessionCookieCleared).
export function authedAction<Args extends unknown[], Result>(
  action: (viewer: Viewer, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result | Unauthenticated> {
  return (...args) =>
    inRequest(async () => {
      const token = await sessionToken();
      const viewer = await authService().authenticate(token);
      if (!viewer) {
        if (token) await clearSessionCookie();
        return { ok: false, code: "unauthenticated" };
      }
      return action(viewer, ...args);
    });
}

export type Client = {
  // the client's limitKey: what the per-IP limit and the sign-in throttle count by
  source: string;
  // the session cookie the request carried, if any
  token: string | undefined;
};

// A Server Action open to visitors without a session: only sign-up and sign-in (server-actions.test.ts). The per-IP
// limit (ADR api-and-auth D6c, AUTH_RATE_LIMIT_PER_MIN) applies before the action runs.
export function publicAction<Args extends unknown[], Result>(
  action: (client: Client, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result | RateLimited> {
  return (...args) =>
    inRequest(async () => {
      const source = await clientSource();
      const wait = takeRateLimit(source);
      if (wait > 0) {
        return {
          ok: false,
          code: "rate_limited",
          retryAfterSeconds: Math.ceil(wait / 1000),
        };
      }
      return action({ source, token: await sessionToken() }, ...args);
    });
}

// The viewer's live sessions, newest first, for the settings page.
export const listSessions = (viewer: Viewer) =>
  authService().listSessions(viewer);

// For the Route Handler a page sends a dead cookie to: clears the cookie only when its session is not live, so a link
// from another site cannot sign anyone out.
export async function clearDeadSessionCookie(): Promise<void> {
  const token = await sessionToken();
  if (token && !(await authService().authenticate(token))) {
    await clearSessionCookie();
  }
}
