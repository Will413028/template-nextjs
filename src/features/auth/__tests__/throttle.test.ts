import { describe, expect, it } from "vitest";
import { limitKey } from "@/server/client-ip";
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

  // ADR auth-and-sign-in-throttling D3: an attacker with many sources (an IPv6 /48 has 65,536 /64s) must not grow the
  // counts without bound
  it("keeps at most maxEntries counts, evicting the least recently counted pair with fewer than 5 failures", () => {
    let now = 0;
    const throttle = new SignInThrottle(() => now, { maxEntries: 3 });
    for (let n = 0; n < 5; n++) throttle.reserve("waiting", "192.0.2.1");
    now = 1;
    for (let n = 0; n < 3; n++) throttle.reserve("old", "192.0.2.1");
    now = 2;
    throttle.reserve("first", "192.0.2.1");
    now = 3;
    throttle.reserve("old", "192.0.2.1"); // its 4th failure: now counted after "first"
    now = 4;
    expect(throttle.reserve("third", "192.0.2.1")).toBe(0);
    expect(throttle.size).toBe(3);
    // "first" went, not "waiting" (older but in its backoff) nor "old" (counted later; its 5th failure starts a wait)
    expect(throttle.reserve("waiting", "192.0.2.1")).toBeGreaterThan(0);
    expect(throttle.reserve("old", "192.0.2.1")).toBe(0);
    expect(throttle.reserve("old", "192.0.2.1")).toBeGreaterThan(0);
  });

  // Evicting a pair in its backoff would reset it: after its wait the next failure must wait longer, not start over
  it("never evicts a pair with 5 or more failures, even after its wait, and lets a new pair through uncounted then", () => {
    let now = 0;
    let full = 0;
    const throttle = new SignInThrottle(() => now, {
      maxEntries: 2,
      onFull: () => full++,
    });
    for (const username of ["a", "b"]) {
      for (let n = 0; n < 5; n++) throttle.reserve(username, "192.0.2.1");
    }
    now = MINUTE; // both waits are over
    for (let n = 0; n < 6; n++) {
      expect(throttle.reserve("c", "192.0.2.1")).toBe(0);
    }
    expect(throttle.size).toBe(2);
    expect(full).toBe(1); // reported once a minute
    expect(throttle.reserve("a", "192.0.2.1")).toBe(0); // the 6th failure
    expect(throttle.reserve("a", "192.0.2.1")).toBe(2 * MINUTE);
    // a freed slot is used again
    throttle.succeeded("b", "192.0.2.1");
    for (let n = 0; n < 5; n++) {
      expect(throttle.reserve("c", "192.0.2.1")).toBe(0);
    }
    expect(throttle.reserve("c", "192.0.2.1")).toBeGreaterThan(0);
  });

  it("reports uncounted attempts at most once a minute, with how many went uncounted", () => {
    let now = 0;
    const reports: number[] = [];
    const throttle = new SignInThrottle(() => now, {
      maxEntries: 1,
      onFull: (uncounted) => reports.push(uncounted),
    });
    for (let n = 0; n < 5; n++) throttle.reserve("a", "192.0.2.1");
    for (const username of ["b", "c", "d"]) {
      throttle.reserve(username, "192.0.2.1");
    }
    expect(reports).toEqual([1]);
    now = MINUTE - 1;
    throttle.reserve("e", "192.0.2.1");
    expect(reports).toEqual([1]);
    now = MINUTE;
    throttle.reserve("f", "192.0.2.1");
    expect(reports).toEqual([1, 4]);
    now = 0; // the clock stepped back
    throttle.reserve("g", "192.0.2.1");
    expect(reports).toEqual([1, 4, 1]);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses maxEntries %s", (maxEntries) => {
    expect(() => new SignInThrottle(Date.now, { maxEntries })).toThrow(
      "maxEntries must be a positive integer",
    );
  });

  it("forgets counts untouched for a day", () => {
    let now = 0;
    const throttle = new SignInThrottle(() => now);
    throttle.reserve("old", "192.0.2.1");
    for (let n = 0; n < 5; n++) throttle.reserve("old-backoff", "192.0.2.1");
    now = 23 * 60 * MINUTE;
    throttle.reserve("new", "192.0.2.1");
    for (let n = 0; n < 5; n++) throttle.reserve("new-backoff", "192.0.2.1");
    now = 24 * 60 * MINUTE;
    expect(throttle.sweep()).toBe(2);
    expect(throttle.sweep()).toBe(0);
    expect(throttle.size).toBe(2);
  });
});
