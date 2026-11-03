import { describe, expect, it } from "vitest";
import { clientIP, limitKey, parsePrefix } from "../server/client-ip";
import { IPLimiter, SignInThrottle } from "../server/throttle";

const MINUTE = 60_000;

describe("IPLimiter", () => {
  it("refills a bucket over time and drops buckets idle for a minute", () => {
    const start = 1_700_000_000_000;
    let now = start;
    const limiter = new IPLimiter(2, () => now);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(30_000);
    now = start + 30_000;
    expect(limiter.take("a")).toBe(0);
    now = start + 60_000;
    limiter.take("b");
    now = start + 100_000;
    limiter.take("b");
    now = start + 120_000;
    limiter.take("c");
    expect(limiter.size).toBe(2);
  });

  it("limits an IPv6 /64 as one client", () => {
    const limiter = new IPLimiter(1, Date.now);
    expect(limiter.take(limitKey("2001:db8:1:2::1"))).toBe(0);
    expect(limiter.take(limitKey("2001:db8:1:2:ffff::9"))).toBeGreaterThan(0);
    expect(limiter.take(limitKey("2001:db8:1:3::1"))).toBe(0);
    expect(limitKey("2001:db8:1:2:ffff::9")).toBe("2001:db8:1:2::");
    expect(limitKey("::ffff:192.0.2.1")).toBe("192.0.2.1");
  });
});

describe("SignInThrottle", () => {
  it("waits 2^(n-5) minutes after the n-th failure, at most an hour, and does not count a refused attempt", () => {
    let now = 0;
    const throttle = new SignInThrottle(() => now);
    for (let n = 1; n <= 12; n++) {
      expect(throttle.reserve("nobody", "192.0.2.1")).toBe(0);
      if (n < 5) continue;
      const want = Math.min(2 ** (n - 5), 60) * MINUTE;
      expect(throttle.reserve("nobody", "192.0.2.1")).toBe(want);
      now += want - 1;
      expect(throttle.reserve("nobody", "192.0.2.1")).toBe(1000);
      now += 1;
    }
  });

  it("counts each source on its own and clears only the source that signed in", () => {
    const throttle = new SignInThrottle(() => 0);
    for (let n = 0; n < 5; n++) throttle.reserve("alice", "192.0.2.1");
    expect(throttle.reserve("alice", "192.0.2.1")).toBeGreaterThan(0);
    // the owner signing in from elsewhere is not locked out by someone else's failures
    expect(throttle.reserve("alice", "198.51.100.7")).toBe(0);
    expect(throttle.reserve("bob", "192.0.2.1")).toBe(0);
    // and that sign-in does not reset the other source's backoff
    throttle.succeeded("alice", "198.51.100.7");
    expect(throttle.reserve("alice", "192.0.2.1")).toBeGreaterThan(0);
    for (let n = 0; n < 4; n++) throttle.reserve("alice", "198.51.100.7");
    expect(throttle.reserve("alice", "198.51.100.7")).toBe(0);
  });

  it("forgets counts untouched for a day", () => {
    let now = 0;
    const throttle = new SignInThrottle(() => now);
    throttle.reserve("old", "192.0.2.1");
    now = 23 * 60 * MINUTE;
    throttle.reserve("new", "192.0.2.1");
    now = 24 * 60 * MINUTE;
    expect(throttle.sweep()).toBe(1);
    expect(throttle.sweep()).toBe(0);
  });
});

// template-go-nextjs middleware_test.go TestClientIP, same table (proxies 172.30.0.0/24)
describe("clientIP", () => {
  const trusted = [parsePrefix("172.30.0.0/24")];
  it.each<[string, string, string[], string]>([
    [
      "untrusted peer ignores XFF",
      "203.0.113.7",
      ["198.51.100.9"],
      "203.0.113.7",
    ],
    ["trusted peer without XFF", "172.30.0.2", [], "172.30.0.2"],
    [
      "rightmost untrusted hop",
      "172.30.0.2",
      ["192.0.2.1, 198.51.100.9"],
      "198.51.100.9",
    ],
    [
      "skips trusted hops",
      "172.30.0.2",
      ["198.51.100.9, 172.30.0.3"],
      "198.51.100.9",
    ],
    [
      "several XFF headers",
      "172.30.0.2",
      ["192.0.2.1", "198.51.100.9"],
      "198.51.100.9",
    ],
    [
      "garbage stops at the last real hop",
      "172.30.0.2",
      ["198.51.100.9, garbage, 172.30.0.3"],
      "172.30.0.3",
    ],
    ["IPv4-mapped IPv6", "::ffff:172.30.0.2", ["198.51.100.9"], "198.51.100.9"],
  ])("%s", (_, peer, forwardedFor, want) => {
    expect(clientIP(peer, forwardedFor, trusted)).toBe(want);
  });

  it("reads an IPv4-mapped prefix as IPv6, as Go's netip does", () => {
    expect(parsePrefix("::ffff:0:0/96")).toMatchObject({ bits: 96, v6: true });
  });

  it("answers null for a peer that is not an address", () => {
    expect(clientIP("", [], trusted)).toBeNull();
  });

  it.each(["172.30.0.0", "172.30.0.0/33", "nope/24", "fd00::/129"])(
    "rejects the trusted-proxy prefix %j",
    (prefix) => {
      expect(() => parsePrefix(prefix)).toThrow("not an address prefix");
    },
  );
});
