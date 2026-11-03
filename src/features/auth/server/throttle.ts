import "server-only";

// Sign-in throttling kept in process memory (plan D7=A): it holds while the app runs as a single instance (D5=A);
// more instances multiply the limits, and a restart forgets every count. Both parts are synchronous, so within one
// Node.js event loop a check and its count cannot interleave with another request: the atomicity template-go-nextjs
// gets from one SQL UPSERT.

// Milliseconds since the epoch; tests pass a fake.
export type Clock = () => number;

const MINUTE = 60_000;

// A token bucket per key: perMinute tokens a minute, bursting to perMinute (template-go-nextjs ratelimit.go
// ipLimiter). Buckets idle for a minute are full again and are dropped.
export class IPLimiter {
  private readonly buckets = new Map<
    string,
    { tokens: number; last: number }
  >();
  private lastSweep: number;

  constructor(
    private readonly perMinute: number,
    private readonly now: Clock,
  ) {
    this.lastSweep = now();
  }

  // 0 when the request may go ahead (a token is taken), else the milliseconds until one is available.
  take(key: string): number {
    const now = this.now();
    this.sweep(now);
    const every = MINUTE / this.perMinute;
    const bucket = this.buckets.get(key) ?? {
      tokens: this.perMinute,
      last: now,
    };
    bucket.tokens = Math.min(
      this.perMinute,
      bucket.tokens + (now - bucket.last) / every,
    );
    bucket.last = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) * every);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < MINUTE) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last >= MINUTE) this.buckets.delete(key);
    }
  }
}

// How long a pair's count is kept after its last attempt; the longest wait is an hour.
const KEEP_FOR = 24 * 60 * MINUTE;

// At most this many pairs are counted (plan D9=D; memory measured in the plan). Without a cap an attacker with many
// sources grows the counts without bound (one source adds up to 7,204 pairs a day at 5 sign-ins a minute; an IPv6 /48
// holds 65,536 /64 sources).
const MAX_ENTRIES = 100_000;

// Failures before the first wait.
const FREE = 5;

type Count = { failures: number; nextAllowedAt: number; updatedAt: number };

// Exponential backoff per username and source (template-go-nextjs ADR account-abuse-and-lifecycle D4a): each source
// has its own count, so one client's failures do not lock out another. The attempt is counted before the password is
// checked, so requests sent together cannot all pass a wait that is not recorded yet. From the 5th consecutive
// failure the next attempt waits 2^(n-5) minutes, at most an hour. A successful sign-in clears its source's count.
//
// When maxEntries pairs are counted, a new pair evicts the least recently counted pair with fewer than 5 failures, in
// constant time. A pair that reached its backoff is never evicted (only the daily sweep drops it), so eviction resets
// at most 4 free attempts, which an attacker able to fill the map already has from each of their sources. When every
// pair has reached its backoff, a new pair's attempt goes ahead uncounted: such an attacker gets 5 attempts a minute
// per source (the per-IP limit) at a username on sources not counted yet, instead of 4 and a wait.
export class SignInThrottle {
  // Keyed by source and username (a source has no spaces). Pairs with fewer than FREE failures, least recently
  // counted first (a count is re-inserted when it changes); the eviction candidates.
  private readonly partial = new Map<string, Count>();
  // Pairs with FREE or more failures; never evicted.
  private readonly backoff = new Map<string, Count>();

  constructor(
    private readonly now: Clock,
    private readonly maxEntries = MAX_ENTRIES,
  ) {}

  // Counts the attempt and returns 0, or returns the milliseconds to wait (at least a second) without counting it.
  reserve(username: string, source: string): number {
    const now = this.now();
    const key = `${source} ${username}`;
    const count = this.partial.get(key) ?? this.backoff.get(key);
    if (count && count.nextAllowedAt > now) {
      return Math.max(1000, count.nextAllowedAt - now);
    }
    if (!count && this.size >= this.maxEntries) {
      const oldest = this.partial.keys().next();
      if (oldest.done) return 0;
      this.partial.delete(oldest.value);
    }
    const failures = (count?.failures ?? 0) + 1;
    const wait =
      failures >= FREE
        ? Math.min(2 ** Math.min(failures - FREE, 6), 60) * MINUTE
        : 0;
    const next = { failures, nextAllowedAt: now + wait, updatedAt: now };
    this.partial.delete(key);
    if (failures >= FREE) this.backoff.set(key, next);
    else this.partial.set(key, next); // last: the most recently counted
    return 0;
  }

  // Clears only the source that signed in: clearing the username's every source would let the owner's own sign-ins
  // reset an attacker's backoff (template-go-nextjs clears them all, alongside an account-wide cap this step defers;
  // plan D2 deviation 11).
  succeeded(username: string, source: string): void {
    const key = `${source} ${username}`;
    this.partial.delete(key);
    this.backoff.delete(key);
  }

  get size(): number {
    return this.partial.size + this.backoff.size;
  }

  // Drops counts untouched for a day.
  sweep(): number {
    const cutoff = this.now() - KEEP_FOR;
    let dropped = 0;
    for (const counts of [this.partial, this.backoff]) {
      for (const [key, count] of counts) {
        if (count.updatedAt <= cutoff) {
          counts.delete(key);
          dropped++;
        }
      }
    }
    return dropped;
  }
}
