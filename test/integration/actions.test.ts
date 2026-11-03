import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ActionResponse,
  actionIds,
  callAction,
  cookieValue,
  setCookieLine,
} from "./action-client";
import { type NextServer, startNext } from "./next-server";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

// The Server Action boundary against the production build (`next start` with the peer preload) and PostgreSQL as the
// app role: every action without a session, the session cookie, cross-origin protection, the per-IP limit and the
// client address. Ported from template-go-nextjs httpapi/auth_test.go, ratelimit_test.go and server_test.go.

const COOKIE = "__Host-session";
const PASSWORD = "a long enough password";

let database: TestDatabase;
// trusts 127.0.0.1, so each test picks its own client address through X-Forwarded-For
let main: NextServer;
// trusts 127.0.0.1, two sign-ups or sign-ins a minute per client
let limited: NextServer;
// trusts no proxy: the client is the TCP peer, 127.0.0.1, whatever X-Forwarded-For says
let untrusted: NextServer;

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  const env = {
    DATABASE_URL: database.url(APP),
    DATABASE_PASSWORD_FILE: database.appPasswordFile,
  };
  [main, limited, untrusted] = await Promise.all([
    startNext({
      ...env,
      TRUSTED_PROXIES: "127.0.0.1/32",
      AUTH_RATE_LIMIT_PER_MIN: "1000",
    }),
    startNext({
      ...env,
      TRUSTED_PROXIES: "127.0.0.1/32",
      AUTH_RATE_LIMIT_PER_MIN: "2",
    }),
    startNext({ ...env, TRUSTED_PROXIES: "", AUTH_RATE_LIMIT_PER_MIN: "2" }),
  ]);
}, 180_000);

afterAll(async () => {
  await Promise.all([main?.stop(), limited?.stop(), untrusted?.stop()]);
  await database?.stop();
});

const ids = actionIds();
const id = (name: string) => {
  const found = ids[`src/features/auth/actions.ts#${name}`];
  if (!found) throw new Error(`no action ${name} in the build`);
  return found;
};

// Test order is random and the servers are shared: each test uses its own usernames and client addresses.
const name = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;
const address = () => `10.${[...randomBytes(3)].join(".")}`;
const from = (ip: string) => ({ "X-Forwarded-For": ip });

function call(
  server: NextServer,
  action: string,
  args: unknown[] = [],
  options: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<ActionResponse> {
  return callAction({
    base: server.base,
    id: id(action),
    args,
    cookie: options.cookie ? `${COOKIE}=${options.cookie}` : undefined,
    headers: { "X-Forwarded-For": address(), ...options.headers },
  });
}

async function signUp(server = main) {
  const username = name("user");
  const response = await call(server, "signUp", [
    null,
    { username, password: PASSWORD },
  ]);
  expect(response.result).toEqual({ ok: true });
  const token = cookieValue(response.setCookie, COOKIE);
  if (!token) throw new Error("sign-up set no session cookie");
  return { username, token, response };
}

const unauthenticated = { ok: false, code: "unauthenticated" };
// The session cookie's Set-Cookie line; the page path also gets next-intl's NEXT_LOCALE cookie, which is not asserted.
const cleared = (response: ActionResponse) =>
  setCookieLine(response.setCookie, COOKIE);

describe("every Server Action in the build", () => {
  const actionFiles = readdirSync("src/features", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `src/features/${d.name}/actions.ts`)
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
  const declared = actionFiles.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export const (\w+)/gm)].map(
      (m) => `${file}#${m[1]}`,
    ),
  );
  const PUBLIC = [
    "src/features/auth/actions.ts#signUp",
    "src/features/auth/actions.ts#signIn",
  ];

  it("comes from a feature's actions.ts, and every action there is in the build", () => {
    expect(Object.keys(ids).sort()).toEqual([...declared].sort());
  });

  it("refuses a request without a session, except sign-up and sign-in", async () => {
    for (const [action, actionId] of Object.entries(ids)) {
      const response = await callAction({
        base: main.base,
        id: actionId,
        args: [null, { id: "00000000-0000-7000-8000-000000000000" }],
        headers: from(address()),
      });
      if (PUBLIC.includes(action)) {
        expect(response.result, action).toMatchObject({
          ok: false,
          code: "invalid_input",
        });
      } else {
        expect(response.result, action).toEqual(unauthenticated);
        expect(cleared(response), action).toBeUndefined();
      }
    }
  });
});

describe("the session cookie", () => {
  it("is __Host-, Secure, HttpOnly, SameSite=Lax, for seven days, and holds a 43-character token", async () => {
    const { token, response } = await signUp();
    const line = setCookieLine(response.setCookie, COOKIE) ?? "";
    expect(line).toMatch(/; Path=\/(;|$)/);
    expect(line).toMatch(/; Secure(;|$)/);
    expect(line).toMatch(/; HttpOnly(;|$)/);
    expect(line).toMatch(/; SameSite=lax(;|$)/i);
    expect(line).toMatch(/; Max-Age=604800(;|$)/);
    expect(line).not.toMatch(/Domain=/i);
    expect(token).toHaveLength(43);
    // a session cookie, never a result the page could read
    expect(JSON.stringify(response.result)).not.toContain(token);
  });

  it("is the only credential: a Bearer token is ignored", async () => {
    const { token } = await signUp();
    const bearer = await call(main, "revokeSession", [null, { id: "x" }], {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bearer.result).toEqual(unauthenticated);
    const withCookie = await call(main, "revokeSession", [null, { id: "x" }], {
      cookie: token,
    });
    expect(withCookie.result).toEqual({ ok: false, code: "not_found" });
  });

  it("is cleared when it is dead, and a sign-in with it gets only the new one", async () => {
    const { username, token } = await signUp();
    const signOut = await call(main, "signOut", [], { cookie: token });
    expect(signOut.result).toEqual({ ok: true });
    expect(cleared(signOut)).toMatch(
      /^__Host-session=; Path=\/; .*Max-Age=0; Secure; HttpOnly/,
    );

    const dead = await call(main, "signOutEverywhere", [], { cookie: token });
    expect(dead.result).toEqual(unauthenticated);
    expect(cleared(dead)).toMatch(/Max-Age=0/);

    const signIn = await call(
      main,
      "signIn",
      [null, { username, password: PASSWORD }],
      {
        cookie: token,
      },
    );
    expect(signIn.result).toEqual({ ok: true });
    expect(
      signIn.setCookie.filter((line) => line.startsWith(`${COOKIE}=`)),
    ).toHaveLength(1);
    expect(cookieValue(signIn.setCookie, COOKIE)).toHaveLength(43);

    // a live session is left alone
    const live = await call(main, "revokeSession", [null, { id: "x" }], {
      cookie: cookieValue(signIn.setCookie, COOKIE),
    });
    expect(cleared(live)).toBeUndefined();
  });

  it("is checked before the arguments are", async () => {
    const response = await call(main, "revokeSession", [
      null,
      { id: { not: "an id" } },
    ]);
    expect(response.result).toEqual(unauthenticated);
  });

  it("is cleared by the sign-in redirect only when its session is dead", async () => {
    const { token } = await signUp();
    const get = (cookie: string, locale: string) =>
      fetch(`${main.base}/api/session/expired?locale=${locale}`, {
        redirect: "manual",
        headers: { Cookie: `${COOKIE}=${cookie}` },
      });
    const live = await get(token, "zh-TW");
    expect(live.status).toBe(307);
    expect(live.headers.get("location")).toBe("/zh-TW/sign-in");
    expect(setCookieLine(live.headers.getSetCookie(), COOKIE)).toBeUndefined();

    await call(main, "signOut", [], { cookie: token });
    const dead = await get(token, "nowhere");
    expect(dead.headers.get("location")).toBe("/en/sign-in");
    expect(setCookieLine(dead.headers.getSetCookie(), COOKIE)).toMatch(
      /Max-Age=0; Secure/,
    );
  });
});

describe("cross-origin protection", () => {
  // Go server_test.go TestCrossOriginPostRejected, plus the cases step 0 (a) added. "executed" is whether the sign-up
  // happened: a cookie was set. The status is not the assertion: a refused action can still answer 200.
  const cases: [string, (host: string) => Record<string, string>, boolean][] = [
    ["cross-site", () => ({ "Sec-Fetch-Site": "cross-site" }), false],
    ["same-site sibling", () => ({ "Sec-Fetch-Site": "same-site" }), false],
    [
      "foreign Origin without Sec-Fetch-Site",
      () => ({ Origin: "https://evil.test" }),
      false,
    ],
    [
      "same-origin",
      (host) => ({ Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin" }),
      true,
    ],
    ["non-browser client", () => ({}), true],
    ["Origin null", () => ({ Origin: "null" }), false],
    [
      "forged X-Forwarded-Host matching a foreign Origin",
      () => ({ Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" }),
      false,
    ],
    // no browser sends this; it shows Next.js's own Origin check behind the proxy's (plan D2 deviation 1)
    [
      "Sec-Fetch-Site same-origin with a foreign Origin",
      () => ({ Origin: "https://evil.test", "Sec-Fetch-Site": "same-origin" }),
      false,
    ],
  ];

  it.each(cases)("%s: executed %s", async (_, headers, executed) => {
    const response = await call(
      main,
      "signUp",
      [null, { username: name("csrf"), password: PASSWORD }],
      {
        headers: headers(main.host),
      },
    );
    expect(cookieValue(response.setCookie, COOKIE) !== undefined).toBe(
      executed,
    );
    expect(
      response.result !== undefined &&
        (response.result as { ok?: boolean }).ok === true,
    ).toBe(executed);
  });
});

describe("the per-IP limit", () => {
  it("allows two sign-ups and two sign-ins a minute per client, then asks to retry in 30 seconds", async () => {
    const retryAfter = (response: ActionResponse) =>
      (response.result as { retryAfterSeconds?: number }).retryAfterSeconds;
    const signUpClient = from(address());
    const newAccount = () => [
      null,
      { username: name("limit"), password: PASSWORD },
    ];
    for (let i = 0; i < 2; i++) {
      const ok = await call(limited, "signUp", newAccount(), {
        headers: signUpClient,
      });
      expect(ok.result, `sign-up ${i + 1}`).toEqual({ ok: true });
    }
    const thirdSignUp = await call(limited, "signUp", newAccount(), {
      headers: signUpClient,
    });
    expect(thirdSignUp.result).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    expect(retryAfter(thirdSignUp)).toBeGreaterThanOrEqual(29);
    expect(retryAfter(thirdSignUp)).toBeLessThanOrEqual(30);

    const { username } = await signUp(main);
    const signInClient = from(address());
    for (let i = 0; i < 2; i++) {
      const wrong = await call(
        limited,
        "signIn",
        [null, { username, password: "not the password" }],
        {
          headers: signInClient,
        },
      );
      expect(wrong.result, `sign-in ${i + 1}`).toEqual({
        ok: false,
        code: "invalid_credentials",
      });
    }
    const thirdSignIn = await call(
      limited,
      "signIn",
      [null, { username, password: PASSWORD }],
      {
        headers: signInClient,
      },
    );
    expect(thirdSignIn.result).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    expect(retryAfter(thirdSignIn)).toBeGreaterThanOrEqual(29);
  });

  it("gives each client behind the trusted proxy its own bucket", async () => {
    const first = from(address());
    for (let i = 0; i < 2; i++) {
      await call(
        limited,
        "signUp",
        [null, { username: name("a"), password: PASSWORD }],
        { headers: first },
      );
    }
    const third = await call(
      limited,
      "signUp",
      [null, { username: name("a"), password: PASSWORD }],
      {
        headers: first,
      },
    );
    expect(third.result).toMatchObject({ code: "rate_limited" });
    const second = await call(limited, "signUp", [
      null,
      { username: name("b"), password: PASSWORD },
    ]);
    expect(second.result).toEqual({ ok: true });
  });

  it("ignores X-Forwarded-For from a peer it does not trust", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        (
          await call(untrusted, "signUp", [
            null,
            { username: name("x"), password: PASSWORD },
          ])
        ).result,
      );
    }
    // each request forged a new X-Forwarded-For; all three count against 127.0.0.1
    expect(results[2]).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("ignores an x-peer-address the client sends: the preload writes the real one", async () => {
    const client = from(address());
    const forged = (peer: string) =>
      call(
        limited,
        "signUp",
        [null, { username: name("p"), password: PASSWORD }],
        {
          headers: { ...client, "x-peer-address": peer },
        },
      );
    // were the forged peers believed, each would be an untrusted client of its own
    await forged("203.0.113.1");
    await forged("203.0.113.2");
    expect((await forged("203.0.113.3")).result).toMatchObject({
      code: "rate_limited",
    });
  });

  it("limits only sign-up and sign-in", async () => {
    const client = from(address());
    for (let i = 0; i < 3; i++) {
      await call(
        limited,
        "signUp",
        [null, { username: name("o"), password: PASSWORD }],
        { headers: client },
      );
    }
    for (let i = 0; i < 3; i++) {
      const response = await call(limited, "signOut", [], { headers: client });
      expect(response.result).toEqual(unauthenticated);
    }
  });
});

describe("sign-in throttling", () => {
  it("answers the sixth failure from one client with the minutes to wait", async () => {
    const { username } = await signUp();
    const client = from(address());
    for (let i = 0; i < 5; i++) {
      const wrong = await call(
        main,
        "signIn",
        [null, { username, password: "not the password" }],
        {
          headers: client,
        },
      );
      expect(wrong.result).toEqual({ ok: false, code: "invalid_credentials" });
    }
    const sixth = await call(
      main,
      "signIn",
      [null, { username, password: PASSWORD }],
      { headers: client },
    );
    expect(sixth.result).toMatchObject({ ok: false, code: "login_throttled" });
    const wait = (sixth.result as { retryAfterSeconds: number })
      .retryAfterSeconds;
    expect(wait).toBeGreaterThanOrEqual(59);
    expect(wait).toBeLessThanOrEqual(60);
    // another client is not held back
    const other = await call(main, "signIn", [
      null,
      { username, password: PASSWORD },
    ]);
    expect(other.result).toEqual({ ok: true });
  });
});
