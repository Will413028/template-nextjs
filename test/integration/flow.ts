import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { actionId, callAction } from "./action-client";

// What a user does from the first visit to signing out (plan step 2 acceptance), without a browser: Server Actions
// posted the way React posts them, pages fetched, cookies kept the way a browser keeps them. pages.test.ts runs it
// against `next start`; CI's stack job runs test/stack/flow.test.ts against the compose stack through Caddy.

const SESSION = "__Host-session";

// A visitor: a cookie jar, the actions of one build (actionIds()) and a base URL.
export function visitor(base: string, ids: Record<string, string>) {
  const jar = new Map<string, string>();
  const cookie = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ") || undefined;
  const keep = (setCookie: string[]) => {
    for (const line of setCookie) {
      const [, name, value] = /^([^=]+)=([^;]*)/.exec(line) ?? [];
      if (!name) continue;
      if (value === "" || /;\s*max-age=0(;|$)/i.test(line)) jar.delete(name);
      else jar.set(name, value ?? "");
    }
  };
  return {
    session: () => jar.get(SESSION),
    async act(name: string, args: unknown[]): Promise<unknown> {
      const id = actionId(ids, name);
      const response = await callAction({ base, id, args, cookie: cookie() });
      keep(response.setCookie);
      return response.result;
    },
    // A form posted to its action from the page at path, the way the browser posts it (FormData).
    async submit(
      name: string,
      form: Record<string, string>,
      path: string,
    ): Promise<unknown> {
      const id = actionId(ids, name);
      const response = await callAction({
        base,
        id,
        form,
        path,
        cookie: cookie(),
      });
      keep(response.setCookie);
      return response.result;
    },
    // One request, redirects not followed: the status, where a redirect points (a path) and the body.
    async get(path: string, options: { cookie?: string } = {}) {
      const sent = options.cookie ?? cookie();
      const response = await fetch(base + path, {
        redirect: "manual",
        headers: sent ? { Cookie: sent } : {},
      });
      if (options.cookie === undefined) keep(response.headers.getSetCookie());
      const location = response.headers.get("location");
      return {
        status: response.status,
        location: location && new URL(location, base).pathname,
        html: await response.text(),
      };
    },
  };
}

export async function signUpToSignOut(
  base: string,
  ids: Record<string, string>,
): Promise<void> {
  const user = visitor(base, ids);
  const username = `flow-${randomBytes(4).toString("hex")}`;
  const credentials = { username, password: "a long enough password" };

  expect(await user.act("signUp", [null, credentials])).toEqual({ ok: true });
  const signedUp = user.session();
  expect(signedUp).toBeTruthy();

  expect(await user.act("signIn", [null, credentials])).toEqual({ ok: true });
  const signedIn = user.session();
  expect(signedIn).toBeTruthy();
  expect(signedIn).not.toBe(signedUp);

  const dashboard = await user.get("/en/dashboard");
  expect(dashboard.status).toBe(200);
  expect(dashboard.html).toContain(username);

  expect(await user.act("signOut", [])).toEqual({ ok: true });
  expect(user.session()).toBeUndefined();

  // the browser dropped the cookie: straight to sign-in
  const after = await user.get("/en/dashboard");
  expect(after.status).toBe(307);
  expect(after.location).toBe("/en/sign-in");

  // a copy of the signed-out cookie is dead: through the route that clears it, then to sign-in
  const stale = `${SESSION}=${signedIn}`;
  const first = await user.get("/en/dashboard", { cookie: stale });
  expect(first.status).toBe(307);
  expect(first.location).toBe("/api/session/expired");
  const second = await fetch(`${base}/api/session/expired?locale=en`, {
    redirect: "manual",
    headers: { Cookie: stale },
  });
  expect(new URL(second.headers.get("location") ?? "", base).pathname).toBe(
    "/en/sign-in",
  );
  expect(
    second.headers
      .getSetCookie()
      .some((line) => line.startsWith(`${SESSION}=;`)),
  ).toBe(true);
}
