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

// Exponential backoff per username and source (template-go-nextjs ADR account-abuse-and-lifecycle D4a): each source
// has its own count, so one client's failures do not lock out another. The attempt is counted before the password is
// checked, so requests sent together cannot all pass a wait that is not recorded yet. From the 5th consecutive
// failure the next attempt waits 2^(n-5) minutes, at most an hour. A successful sign-in clears its source's count.
export class SignInThrottle {
  private readonly counts = new Map<
    string,
    Map<string, { failures: number; nextAllowedAt: number; updatedAt: number }>
  >();

  constructor(private readonly now: Clock) {}

  // Counts the attempt and returns 0, or returns the milliseconds to wait (at least a second) without counting it.
  reserve(username: string, source: string): number {
    const now = this.now();
    const sources = this.counts.get(username) ?? new Map();
    const count = sources.get(source);
    if (count && count.nextAllowedAt > now) {
      return Math.max(1000, count.nextAllowedAt - now);
    }
    const failures = (count?.failures ?? 0) + 1;
    const wait =
      failures >= 5 ? Math.min(2 ** Math.min(failures - 5, 6), 60) * MINUTE : 0;
    sources.set(source, {
      failures,
      nextAllowedAt: now + wait,
      updatedAt: now,
    });
    this.counts.set(username, sources);
    return 0;
  }

  // Clears only the source that signed in: clearing the username's every source would let the owner's own sign-ins
  // reset an attacker's backoff (template-go-nextjs clears them all, alongside an account-wide cap this step defers;
  // plan D2 deviation 11).
  succeeded(username: string, source: string): void {
    const sources = this.counts.get(username);
    sources?.delete(source);
    if (sources?.size === 0) this.counts.delete(username);
  }

  // Drops counts untouched for a day.
  sweep(): number {
    const cutoff = this.now() - KEEP_FOR;
    let dropped = 0;
    for (const [username, sources] of this.counts) {
      for (const [source, count] of sources) {
        if (count.updatedAt <= cutoff) {
          sources.delete(source);
          dropped++;
        }
      }
      if (sources.size === 0) this.counts.delete(username);
    }
    return dropped;
  }
}
