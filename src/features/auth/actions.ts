"use server";

import { authedAction, publicAction } from "./server";
import {
  authService,
  clearSessionCookie,
  sessionToken,
  setSessionCookie,
} from "./server/runtime";

// The auth feature's Server Actions. Each is a public POST endpoint, reachable from any path, so each is wrapped:
// authedAction checks the session first, publicAction the per-IP limit (server-actions.test.ts). The token goes into
// the cookie only and is never part of a result. The signatures fit useActionState: (previous state, form input).

// A form posts FormData; a client component or a test may post a plain object. The service validates either.
const formInput = (input: unknown) =>
  input instanceof FormData ? Object.fromEntries(input) : input;

export const signUp = publicAction(
  async (_client, _previous: unknown, input: unknown) => {
    const result = await authService().signUp(formInput(input));
    if (!result.ok) return result;
    await setSessionCookie(result.token, result.maxAgeSeconds);
    return { ok: true as const };
  },
);

// The session cookie the request carried is deleted with the sign-in (session fixation).
export const signIn = publicAction(
  async (client, _previous: unknown, input: unknown) => {
    const result = await authService().signIn(formInput(input), {
      source: client.source,
      previousToken: client.token,
    });
    if (!result.ok) return result;
    await setSessionCookie(result.token, result.maxAgeSeconds);
    return { ok: true as const };
  },
);

export const signOut = authedAction(async () => {
  await authService().signOut(await sessionToken());
  await clearSessionCookie();
  return { ok: true as const };
});

export const signOutEverywhere = authedAction(async (viewer) => {
  await authService().signOutEverywhere(viewer);
  await clearSessionCookie();
  return { ok: true as const };
});

// Another user's session id is not found, the same as one that does not exist.
export const revokeSession = authedAction(
  async (viewer, _previous: unknown, input: unknown) => {
    const fields = formInput(input);
    const id =
      fields && typeof fields === "object" && "id" in fields ? fields.id : "";
    const result = await authService().revokeSession(
      viewer,
      typeof id === "string" ? id : "",
    );
    // UUIDs compare case-insensitively in PostgreSQL, so the current session may come back in capitals
    if (
      result.ok &&
      typeof id === "string" &&
      id.toLowerCase() === viewer.sessionId
    ) {
      await clearSessionCookie();
    }
    return result;
  },
);

// Needs a session issued within ten minutes (the service checks); everything the account owns goes with it. A session
// that ended between authedAction's check and the delete leaves a cookie that names nothing: cleared too.
export const deleteAccount = authedAction(async (viewer) => {
  const result = await authService().deleteAccount(viewer);
  if (result.ok || result.code === "session_invalid") {
    await clearSessionCookie();
  }
  return result;
});
