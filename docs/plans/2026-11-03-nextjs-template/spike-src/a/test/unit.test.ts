import { describe, expect, it } from "vitest";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { clientIP, limitKey, parsePrefix } from "../lib/client-ip";
import { IPLimiter, SignInThrottle } from "../lib/throttle";

describe("argon2id (Go service_test TestArgon2Hash)", () => {
  it("ADR params, verify, other params still verify, garbage is a mismatch", async () => {
    const enc = await hash("correct horse battery staple", { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    console.log("[argon2] encoded:", enc);
    expect(enc.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await verify(enc, "correct horse battery staple")).toBe(true);
    expect(await verify(enc, "correct horse battery stapler")).toBe(false);
    const cheap = await hash("pw", { algorithm: Algorithm.Argon2id, memoryCost: 64, timeCost: 1, parallelism: 1 });
    expect(await verify(cheap, "pw")).toBe(true);
    for (const bad of ["", "$2b$12$abc", "$argon2id$v=19$m=0,t=1,p=1$c2FsdA$a2V5", "$argon2id$v=19$m=64,t=1,p=1$!$a2V5"]) {
      const r = await verify(bad, "pw").then((ok) => `ok=${ok}`, (e: Error) => `throws: ${e.message}`);
      console.log(`[argon2] verify(${JSON.stringify(bad)}) -> ${r}`);
      expect(r.startsWith("ok=true")).toBe(false);
    }
  });
});

// Go middleware_test.go TestClientIP, same table (proxies 172.30.0.0/24).
describe("clientIP (Go TestClientIP)", () => {
  const tr = [parsePrefix("172.30.0.0/24")];
  const cases: [string, string, string[], string][] = [
    ["untrusted peer ignores XFF", "203.0.113.7", ["198.51.100.9"], "203.0.113.7"],
    ["trusted peer without XFF", "172.30.0.2", [], "172.30.0.2"],
    ["rightmost untrusted hop", "172.30.0.2", ["192.0.2.1, 198.51.100.9"], "198.51.100.9"],
    ["skips trusted hops", "172.30.0.2", ["198.51.100.9, 172.30.0.3"], "198.51.100.9"],
    ["several XFF headers", "172.30.0.2", ["192.0.2.1", "198.51.100.9"], "198.51.100.9"],
    ["garbage stops at the last real hop", "172.30.0.2", ["198.51.100.9, garbage, 172.30.0.3"], "172.30.0.3"],
    ["IPv4-mapped IPv6", "::ffff:172.30.0.2", ["198.51.100.9"], "198.51.100.9"],
  ];
  for (const [name, peer, xff, want] of cases) it(name, () => expect(clientIP(peer, xff, tr)).toBe(want));
});

describe("IP limiter (Go ratelimit_test)", () => {
  it("TestIPLimiterKeysIPv6By64", () => {
    const l = new IPLimiter(1, Date.now);
    l.wait(limitKey("2001:db8:1:2::1"));
    expect(l.wait(limitKey("2001:db8:1:2:ffff::9"))).toBeGreaterThan(0);
    expect(l.wait(limitKey("2001:db8:1:3::1"))).toBe(0);
    expect(limitKey("2001:db8:1:2:ffff::9")).toBe("2001:db8:1:2::");
  });
  it("TestIPLimiterRefillsAndSweeps", () => {
    const start = 1_700_000_000_000;
    let now = start;
    const l = new IPLimiter(2, () => now);
    l.wait("a"); l.wait("a");
    expect(l.wait("a")).toBe(30_000);
    now = start + 30_000;
    expect(l.wait("a")).toBe(0);
    now = start + 60_000; l.wait("b");
    now = start + 100_000; l.wait("b");
    now = start + 120_000; l.wait("c");
    expect(l.size()).toBe(2); // a swept, b and c kept
  });
});

describe("account+source backoff (Go service_test TestLoginThrottleSchedule)", () => {
  it("wait after the n-th failure (n>=5) is 2^(n-5) min, max 1h; blocked attempts do not count", () => {
    let now = 0;
    const t = new SignInThrottle(() => now);
    for (let n = 1; n <= 12; n++) {
      expect(t.reserve("nobody", "192.0.2.1")).toBe(0);
      if (n < 5) continue;
      const want = Math.min(2 ** (n - 5), 60) * 60_000;
      expect(t.reserve("nobody", "192.0.2.1")).toBe(want);
      expect(t.reserve("nobody", "192.0.2.2")).toBe(0); // another source is not throttled...
      t.succeeded("nobody", "192.0.2.2"); // ...and stays clean for this test
      now += want;
    }
  });
});
