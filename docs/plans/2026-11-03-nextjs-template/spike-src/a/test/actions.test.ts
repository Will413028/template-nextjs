// Integration: `pnpm build` first, then `pnpm test`. Starts `next start` per scenario; no browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionIdsFromDir, advanceClock, callAction, cookieValue, effects, reset } from "./action-client";
import { startNext } from "./next-server";

const ids = actionIdsFromDir(".next");
const PING = ids["app/actions.ts#ping"];
const SIGNUP = ids["app/actions.ts#signUp"];
const SIGNIN = ids["app/actions.ts#signIn"];
const UNGUARDED = ids["app/protected/actions.ts#protectedUnguarded"];
const GUARDED = ids["app/protected/actions.ts#protectedGuarded"];
const SHARED = ids["app/shared-actions.ts#sharedUnguarded"];

type Srv = Awaited<ReturnType<typeof startNext>>;

async function ran(base: string, action: string) {
  return (await effects(base)).effects.some((e) => e.action === action);
}

describe("item 2: __Host-session cookie from cookies() in a Server Action", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext(); });
  afterAll(() => s.stop());
  it("raw Set-Cookie", async () => {
    const r = await callAction({ base: s.base, id: PING, args: ["cookie"] });
    console.log("[cookie] status", r.status, "Set-Cookie:", r.setCookie);
    const c = r.setCookie.find((v) => v.startsWith("__Host-session="))!;
    expect(c).toMatch(/; Path=\/(;|$)/);
    expect(c).toMatch(/; Secure(;|$)/);
    expect(c).toMatch(/; HttpOnly(;|$)/);
    expect(c).toMatch(/; SameSite=lax(;|$)/i);
    expect(c).not.toMatch(/Domain=/i);
    expect(cookieValue(r.setCookie, "__Host-session")).toHaveLength(43);
    expect(r.result).toBe("pong:cookie");
  });
});

// Go server_test.go TestCrossOriginPostRejected (5 table cases) + extra cases. host = 127.0.0.1:<port>.
function csrfCases(host: string): { name: string; go: "blocked" | "allowed"; goSource: string; headers: Record<string, string> }[] {
  return [
    { name: "cross-site", go: "blocked", goSource: "Go table", headers: { "Sec-Fetch-Site": "cross-site" } },
    { name: "same-site sibling", go: "blocked", goSource: "Go table", headers: { "Sec-Fetch-Site": "same-site" } },
    { name: "foreign Origin without Sec-Fetch-Site", go: "blocked", goSource: "Go table", headers: { Origin: "https://evil.test" } },
    { name: "same-origin", go: "allowed", goSource: "Go table", headers: { "Sec-Fetch-Site": "same-origin" } },
    { name: "non-browser client", go: "allowed", goSource: "Go table", headers: {} },
    { name: "x browser cross-site (Origin+SFS)", go: "blocked", goSource: "extra", headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" } },
    { name: "x browser same-site sibling (Origin+SFS)", go: "blocked", goSource: "extra", headers: { Origin: "https://api.evil-sibling.test", "Sec-Fetch-Site": "same-site" } },
    { name: "x Origin null", go: "blocked", goSource: "extra", headers: { Origin: "null" } },
    { name: "x browser same-origin (Origin+SFS)", go: "allowed", goSource: "extra", headers: { Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin" } },
    { name: "x forged X-Forwarded-Host = evil Origin (direct to Next)", go: "blocked", goSource: "extra", headers: { Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" } },
  ];
}

async function csrfMatrix(s: Srv, label: string) {
  const host = new URL(s.base).host;
  const rows: string[] = [];
  for (const c of csrfCases(host)) {
    await reset(s.base);
    const r = await callAction({ base: s.base, id: PING, args: [c.name], headers: c.headers });
    const executed = await ran(s.base, "ping");
    const cookie = r.setCookie.some((v) => v.startsWith("__Host-session="));
    const next = executed || cookie ? "allowed" : "blocked";
    rows.push(`[csrf ${label}] ${c.name.padEnd(58)} go=${c.go.padEnd(7)} next=${next.padEnd(7)} status=${r.status} executed=${executed} setCookie=${cookie}`);
    // the action never runs without also setting the cookie, and vice versa
    expect(executed).toBe(cookie);
  }
  console.log(rows.join("\n"));
  return rows;
}

describe("item 3: CSRF, Next built-in only", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext(); });
  afterAll(() => s.stop());
  it("matrix", async () => {
    const rows = await csrfMatrix(s, "builtin");
    console.log("[csrf builtin] server log lines:\n" + s.logs.join("").split("\n").filter((l) => /origin|Origin/.test(l)).join("\n"));
    expect(rows.find((r) => r.includes("foreign Origin without"))).toContain("next=blocked");
  });
});

describe("item 3: CSRF, with Fetch Metadata check in proxy.ts", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext({ SPIKE_FETCH_METADATA: "1" }); });
  afterAll(() => s.stop());
  it("matrix: every case matches Go", async () => {
    const rows = await csrfMatrix(s, "proxy-fm");
    for (const r of rows) {
      const go = r.match(/go=(\w+)/)![1];
      const next = r.match(/next=(\w+)/)![1];
      expect(next, r).toBe(go);
    }
  });
});

describe("item 4: where the session check must live", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext(); });
  afterAll(() => s.stop());
  it("page-level redirect does not stop an action; any page path reaches any action", async () => {
    const out: string[] = [];
    for (const path of ["/protected", "/", "/does-not-exist"]) {
      await reset(s.base);
      const r = await callAction({ base: s.base, path, id: UNGUARDED, args: ["anon"] });
      out.push(`[layer page-only] POST ${path} unguarded, no cookie: status=${r.status} executed=${await ran(s.base, "protectedUnguarded")}`);
    }
    await reset(s.base);
    const g = await callAction({ base: s.base, path: "/", id: GUARDED, args: ["anon"] });
    out.push(`[layer in-action] POST / guarded, no cookie: status=${g.status} executed=${await ran(s.base, "protectedGuarded")} result=${JSON.stringify(g.result)?.slice(0, 80)}`);
    const login = await callAction({ base: s.base, id: PING, args: ["u"] });
    const cookie = `__Host-session=${cookieValue(login.setCookie, "__Host-session")}`;
    const g2 = await callAction({ base: s.base, path: "/", id: GUARDED, args: ["auth"], cookie });
    out.push(`[layer in-action] POST / guarded, with cookie: status=${g2.status} executed=${await ran(s.base, "protectedGuarded")}`);
    console.log(out.join("\n"));
    expect(out[0]).toContain("executed=true");
    expect(out[3]).toContain("executed=false");
    expect(out[4]).toContain("executed=true");
  });
});

describe("item 4: proxy.ts path-based session check", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext({ SPIKE_PROXY_AUTH: "1" }); });
  afterAll(() => s.stop());
  it("guards /protected; a page-specific action posted to / is forwarded back through the proxy; a shared action is not", async () => {
    const out: string[] = [];
    for (const [label, id, action] of [["page-specific", UNGUARDED, "protectedUnguarded"], ["shared", SHARED, "sharedUnguarded"]] as const) {
      for (const path of ["/protected", "/"]) {
        await reset(s.base);
        const r = await callAction({ base: s.base, path, id, args: ["anon"] });
        out.push(`[layer proxy] ${label} POST ${path}, no cookie: status=${r.status} executed=${await ran(s.base, action)}`);
      }
    }
    console.log(out.join("\n"));
    expect(out.map((l) => l.endsWith("executed=true"))).toEqual([false, false, false, true]);
  });
});

describe("item 5: in-process sign-in throttling through the signIn action", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext({ SPIKE_MAX_HASHES: "4" }); });
  afterAll(() => s.stop());
  const from = (ip: string) => ({ "X-Forwarded-For": ip }); // rightmost-XFF mode (Next reachable only via Caddy)
  const signIn = (base: string, ip: string, account: string, pw: string) =>
    callAction({ base, id: SIGNIN, args: [account, pw], headers: from(ip) });

  it("TestSignInThrottlePerClient + TestLoginThrottlePerAccount shape", async () => {
    await reset(s.base);
    await callAction({ base: s.base, id: SIGNUP, args: ["alice", "a long enough password"] });
    for (const account of ["alice", "nobody"]) {
      for (let i = 0; i < 5; i++) expect((await signIn(s.base, "198.51.100.1", account, "not the password")).result).toEqual({ error: "invalid_credentials" });
      const t = (await signIn(s.base, "198.51.100.1", account, "not the password")).result as { error: string; retryAfter: number };
      expect(t.error).toBe("login_throttled");
      expect(t.retryAfter).toBeGreaterThanOrEqual(59); // real clock (Go freezes it and asserts 60)
      expect(t.retryAfter).toBeLessThanOrEqual(60);
    }
    expect((await signIn(s.base, "198.51.100.1", "alice", "a long enough password")).result).toMatchObject({ error: "login_throttled" });
    // another source signs in at once
    expect((await signIn(s.base, "198.51.100.2", "alice", "a long enough password")).result).toEqual({ ok: true });
    // same /64 is the same source; another /64 is not
    for (let i = 0; i < 5; i++) await signIn(s.base, "2001:db8:1:2::1", "alice", "x");
    expect((await signIn(s.base, "2001:db8:1:2:ffff::9", "alice", "a long enough password")).result).toMatchObject({ error: "login_throttled" });
    expect((await signIn(s.base, "2001:db8:1:3::1", "alice", "a long enough password")).result).toEqual({ ok: true });
    // after the wait the right password works and the count starts over
    await advanceClock(s.base, 60_000);
    expect((await signIn(s.base, "198.51.100.1", "alice", "a long enough password")).result).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) await signIn(s.base, "198.51.100.1", "alice", "x");
    expect((await signIn(s.base, "198.51.100.1", "alice", "a long enough password")).result).toEqual({ ok: true });
  });

  it("TestLoginThrottleConcurrent: 20 at once -> 5 checked, 15 throttled, 5 hashes", async () => {
    await reset(s.base);
    await callAction({ base: s.base, id: SIGNUP, args: ["alice", "a long enough password"] });
    const rs = await Promise.all(Array.from({ length: 20 }, () => signIn(s.base, "203.0.113.9", "alice", "not the password")));
    const count = (e: string) => rs.filter((r) => (r.result as { error?: string })?.error === e).length;
    const verifies = (await effects(s.base)).effects.filter((e) => e.action === "verify").length;
    console.log(`[throttle concurrent] invalid=${count("invalid_credentials")} throttled=${count("login_throttled")} verifies=${verifies}`);
    expect([count("invalid_credentials"), count("login_throttled"), verifies]).toEqual([5, 15, 5]);
  });
});

describe("item 5: per-IP limit on the signIn action (Go TestRateLimitAuthOperations)", () => {
  let s: Srv;
  beforeAll(async () => { s = await startNext({ SPIKE_AUTH_RATE_PER_MIN: "2" }); });
  afterAll(() => s.stop());
  it("2/min: third is rate_limited with retryAfter 30", async () => {
    await reset(s.base);
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await callAction({ base: s.base, id: SIGNIN, args: ["a", "b"], headers: { "X-Forwarded-For": "198.51.100.7" } })).result);
    console.log("[ip limit]", JSON.stringify(r));
    expect(r[2]).toMatchObject({ error: "rate_limited" });
    expect([29, 30]).toContain((r[2] as { retryAfter: number }).retryAfter); // real clock; Go asserts 30
  });
});

describe("item 6: client IP as Next sees it (direct, no Caddy)", () => {
  let plain: Srv, untrusted: Srv, trusted: Srv;
  beforeAll(async () => {
    plain = await startNext();
    untrusted = await startNext({ SPIKE_TRUSTED_PROXIES: "172.30.0.0/24" }, { preload: true });
    trusted = await startNext({ SPIKE_TRUSTED_PROXIES: "127.0.0.1/32" }, { preload: true });
  });
  afterAll(async () => { await plain.stop(); await untrusted.stop(); await trusted.stop(); });
  const hdr = async (base: string, h: Record<string, string> = {}) => (await fetch(base + "/spike/headers", { headers: h })).json();
  it("headers", async () => {
    const out = {
      plainNoXff: await hdr(plain.base),
      plainForgedXff: await hdr(plain.base, { "X-Forwarded-For": "6.6.6.6" }),
      preloadUntrustedPeerForgedXff: await hdr(untrusted.base, { "X-Forwarded-For": "6.6.6.6", "X-Spike-Peer": "172.30.0.2" }),
      preloadTrustedPeerXff: await hdr(trusted.base, { "X-Forwarded-For": "6.6.6.6, 198.51.100.9" }),
    };
    console.log("[client ip]", JSON.stringify(out, null, 1));
    expect(out.plainNoXff.xff).toBe("127.0.0.1");
    expect(out.plainForgedXff.xff).toBe("6.6.6.6"); // Next passes a client XFF through untouched
    expect(out.preloadUntrustedPeerForgedXff.resolved.ip).toBe("127.0.0.1");
    expect(out.preloadTrustedPeerXff.resolved.ip).toBe("198.51.100.9");
  });
});
