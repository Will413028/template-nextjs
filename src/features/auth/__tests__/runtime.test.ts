import { afterEach, describe, expect, it, vi } from "vitest";
import { authService } from "../server/runtime";

// The auth runtime is made once per process. A configuration error must surface before it starts anything, or each
// request that retries would leave another hourly cleanup timer behind.
vi.mock("@/server/env", () => ({
  authConfig: () => ({ rateLimitPerMinute: 5 }),
  trustedProxyConfig: () => ["172.29.0.2"],
}));
vi.mock("@/server/db", () => ({ db: () => ({}) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth runtime", () => {
  it("refuses a bad TRUSTED_PROXIES before it starts the cleanup timer", () => {
    const timers = vi.spyOn(globalThis, "setInterval");
    expect(() => authService()).toThrow("not an address prefix: 172.29.0.2");
    expect(() => authService()).toThrow("not an address prefix");
    expect(timers).not.toHaveBeenCalled();
  });
});
