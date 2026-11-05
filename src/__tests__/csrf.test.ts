import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy, { config } from "../proxy";

// Cross-origin protection in the proxy (ADR auth-and-sign-in-throttling D1, deviation 1), ported from
// template-go-nextjs server_test.go TestCrossOriginPostRejected: Go's http.CrossOriginProtection order. Sec-Fetch-Site
// decides when present; without it, the Origin's host must equal Host (never X-Forwarded-Host, which a client can send
// straight to Next.js); a request with neither is a non-browser client and passes. Next.js's own Origin check stays as
// a second layer.
function post(path: string, headers: Record<string, string>) {
  return proxy(
    new NextRequest(`http://app.test${path}`, {
      method: "POST",
      headers: { host: "app.test", "next-action": "0123abcd", ...headers },
    }),
  );
}

const blocked = (response: Response) => response.status === 403;

describe("cross-origin protection", () => {
  it.each([
    // Go TestCrossOriginPostRejected's table
    ["cross-site", { "sec-fetch-site": "cross-site" }, true],
    ["same-site sibling", { "sec-fetch-site": "same-site" }, true],
    [
      "foreign Origin without Sec-Fetch-Site",
      { origin: "https://evil.test" },
      true,
    ],
    ["same-origin", { "sec-fetch-site": "same-origin" }, false],
    ["non-browser client", {}, false],
    // added by the initial spikes
    [
      "browser cross-site",
      { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
      true,
    ],
    ["Origin null", { origin: "null" }, true],
    [
      "same Origin as Host",
      { origin: "http://app.test", "sec-fetch-site": "same-origin" },
      false,
    ],
    ["typed into the address bar", { "sec-fetch-site": "none" }, false],
    [
      "forged X-Forwarded-Host matching a foreign Origin",
      { origin: "https://evil.test", "x-forwarded-host": "evil.test" },
      true,
    ],
  ] as const)("%s: blocked %s", (_, headers, want) => {
    expect(blocked(post("/en", headers))).toBe(want);
  });

  it("checks every path an action can be posted to, not only pages", () => {
    for (const path of ["/api/health", "/does-not-exist", "/robots.txt"]) {
      expect(blocked(post(path, { "sec-fetch-site": "cross-site" }))).toBe(
        true,
      );
    }
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/api/health", "/en/settings", "/robots.txt", "/"]) {
      expect(matcher.test(path), path).toBe(true);
    }
    expect(matcher.test("/_next/static/chunks/main.js")).toBe(false);
  });

  it("lets safe methods through from anywhere", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const response = proxy(
        new NextRequest("http://app.test/api/health", {
          method,
          headers: { host: "app.test", "sec-fetch-site": "cross-site" },
        }),
      );
      expect(blocked(response), method).toBe(false);
    }
  });
});
