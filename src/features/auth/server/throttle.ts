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

// A pair with fewer than FREE failures, in a doubly linked list from least to most recently counted. A Map alone keeps
// that order, but V8 leaves a deleted entry as a gap until the table is rebuilt and each new iterator walks past every
// gap at the front, so taking the oldest of a Map after many evictions is not constant time (measured: 20,000
// evictions from a 100,000-entry Map took 4.2 s).
type Partial = Count & { key: string; older?: Partial; newer?: Partial };

export type SignInThrottleOptions = {
  maxEntries?: number;
  // Called at most once a minute while a new pair's attempt goes ahead uncounted because the map is full.
  onFull?: () => void;
};

// Exponential backoff per username and source (template-go-nextjs ADR account-abuse-and-lifecycle D4a): each source
// has its own count, so one client's failures do not lock out another. The attempt is counted before the password is
// checked, so requests sent together cannot all pass a wait that is not recorded yet. From the 5th consecutive
// failure the next attempt waits 2^(n-5) minutes, at most an hour. A successful sign-in clears its source's count.
//
// When maxEntries pairs are counted, a new pair evicts the least recently counted pair with fewer than 5 failures, in
// constant time. A pair that reached its backoff is never evicted (only the daily sweep drops it), so an eviction
// resets at most 4 free attempts (a source can have its own pairs evicted over and over, which the per-IP limit still
// bounds). When every pair has reached its backoff, a new pair's attempt goes ahead uncounted and onFull is called:
// until the sweep frees room, each source not counted yet gets the per-IP limit's 5 attempts a minute at a username
// instead of 4 and a wait (plan D9).
export class SignInThrottle {
  // Keyed by source and username (a source has no spaces).
  private readonly partial = new Map<string, Partial>();
  private oldest: Partial | undefined;
  private newest: Partial | undefined;
  // Pairs with FREE or more failures; never evicted.
  private readonly backoff = new Map<string, Count>();
  private readonly maxEntries: number;
  private readonly onFull: () => void;
  private lastFullReport = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: Clock,
    options: SignInThrottleOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    this.onFull = options.onFull ?? (() => {});
  }

  // Returns the milliseconds to wait (at least a second) without counting the attempt, or 0: the attempt is counted,
  // or goes ahead uncounted when the map is full of pairs in their backoff.
  reserve(username: string, source: string): number {
    const now = this.now();
    const key = `${source} ${username}`;
    const count = this.partial.get(key) ?? this.backoff.get(key);
    if (count && count.nextAllowedAt > now) {
      return Math.max(1000, count.nextAllowedAt - now);
    }
    if (!count && this.size >= this.maxEntries) {
      if (!this.oldest) {
        if (now - this.lastFullReport >= MINUTE) {
          this.lastFullReport = now;
          this.onFull();
        }
        return 0;
      }
      this.removePartial(this.oldest.key);
    }
    const failures = (count?.failures ?? 0) + 1;
    const wait =
      failures >= FREE
        ? Math.min(2 ** Math.min(failures - FREE, 6), 60) * MINUTE
        : 0;
    const next = { failures, nextAllowedAt: now + wait, updatedAt: now };
    this.removePartial(key);
    if (failures >= FREE) this.backoff.set(key, next);
    else this.appendPartial({ ...next, key });
    return 0;
  }

  // Clears only the source that signed in: clearing the username's every source would let the owner's own sign-ins
  // reset an attacker's backoff (template-go-nextjs clears them all, alongside an account-wide cap this step defers;
  // plan D2 deviation 11).
  succeeded(username: string, source: string): void {
    const key = `${source} ${username}`;
    this.removePartial(key);
    this.backoff.delete(key);
  }

  get size(): number {
    return this.partial.size + this.backoff.size;
  }

  // Drops counts untouched for a day. The partial list is in updatedAt order, so it stops at the first one kept.
  sweep(): number {
    const cutoff = this.now() - KEEP_FOR;
    let dropped = 0;
    while (this.oldest && this.oldest.updatedAt <= cutoff) {
      this.removePartial(this.oldest.key);
      dropped++;
    }
    for (const [key, count] of this.backoff) {
      if (count.updatedAt <= cutoff) {
        this.backoff.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  private appendPartial(node: Partial): void {
    node.older = this.newest;
    if (this.newest) this.newest.newer = node;
    else this.oldest = node;
    this.newest = node;
    this.partial.set(node.key, node);
  }

  private removePartial(key: string): void {
    const node = this.partial.get(key);
    if (!node) return;
    this.partial.delete(key);
    if (node.older) node.older.newer = node.newer;
    else this.oldest = node.newer;
    if (node.newer) node.newer.older = node.older;
    else this.newest = node.older;
  }
}
