// In-process sign-in throttling (plan D7=A), single instance only.
// 1. per-IP token bucket: perMin tokens/min, burst perMin (Go ratelimit.go ipLimiter, golang.org/x/time/rate).
// 2. "account + source" backoff: every attempt not blocked is counted BEFORE the password check (Go
//    ReserveLoginAttempt); from the 5th consecutive failure the next attempt waits 2^(n-5) min, max 60 min;
//    success clears the pair. Source = limitKey(ip) (IPv6 /64).
// Everything below is synchronous: in one Node event loop, check-and-count cannot interleave, which is what the
// Go version gets from the single UPSERT ... WHERE next_allowed_at <= now.

export type Clock = () => number; // ms

export class IPLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  private lastSweep: number;
  constructor(private perMin: number, private now: Clock) {
    this.lastSweep = now();
  }
  /** 0 if a token was taken, else ms until one is available. */
  wait(key: string): number {
    const now = this.now();
    this.sweep(now);
    const every = 60_000 / this.perMin;
    const b = this.buckets.get(key) ?? { tokens: this.perMin, last: now };
    b.tokens = Math.min(this.perMin, b.tokens + (now - b.last) / every);
    b.last = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) * every);
  }
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (now - b.last >= 60_000) this.buckets.delete(k);
  }
  size() {
    return this.buckets.size;
  }
}

export class SignInThrottle {
  private rows = new Map<string, { failures: number; nextAllowedAt: number | null; updatedAt: number }>();
  constructor(private now: Clock) {}
  private key(account: string, source: string) {
    return `${account}\u0000${source}`;
  }
  /** Counts the attempt and returns 0, or returns ms to wait (attempt not counted). */
  reserve(account: string, source: string): number {
    const now = this.now();
    const k = this.key(account, source);
    const r = this.rows.get(k);
    if (r && r.nextAllowedAt !== null && r.nextAllowedAt > now) return Math.max(1000, r.nextAllowedAt - now);
    const failures = (r?.failures ?? 0) + 1;
    const nextAllowedAt = failures >= 5 ? now + Math.min(2 ** Math.min(failures - 5, 6), 60) * 60_000 : null;
    this.rows.set(k, { failures, nextAllowedAt, updatedAt: now });
    return 0;
  }
  succeeded(account: string, source: string) {
    this.rows.delete(this.key(account, source));
  }
  /** Rows untouched for a day can go (Go throttleTTL); called opportunistically. */
  sweep() {
    const cutoff = this.now() - 24 * 3600_000;
    for (const [k, r] of this.rows) if (r.updatedAt < cutoff) this.rows.delete(k);
  }
}
