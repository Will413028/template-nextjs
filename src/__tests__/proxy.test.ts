import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "../proxy";

function get(path: string) {
  return proxy(new NextRequest(`http://localhost${path}`));
}

const nonceOf = (response: Response) =>
  /'nonce-([^']+)'/.exec(
    response.headers.get("content-security-policy") ?? "",
  )?.[1];

describe("proxy", () => {
  it("allows only scripts with a fresh nonce, which it passes on to rendering", () => {
    const response = get("/en");
    const nonce = nonceOf(response);
    expect(nonce).toBeTruthy();
    expect(nonceOf(get("/en"))).not.toBe(nonce);
    // Next reads the request's CSP header to put the nonce on its scripts
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toContain(`'nonce-${nonce}'`);
  });

  it("allows connecting, framing and form posts only to its own origin", () => {
    const csp = get("/en").headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self';");
    expect(csp).not.toContain("unsafe-eval");
  });

  it.each([
    ["a page", "GET", "/en"],
    ["a route outside the pages", "GET", "/api/health"],
    ["a cross-origin post it refuses", "POST", "/en"],
  ])("gives %s a new UUIDv7 request id and passes it on", (_, method, path) => {
    const response = proxy(
      new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
          "Sec-Fetch-Site": "cross-site",
          // from a client, not a trusted proxy: never believed
          "X-Request-ID": "abc-123",
        },
      }),
    );
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    if (response.status !== 403) {
      expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
        id,
      );
    }
    expect(
      proxy(new NextRequest(`http://localhost${path}`)).headers.get(
        "x-request-id",
      ),
    ).not.toBe(id);
  });

  it("sends a path without a locale to the default locale", () => {
    const response = get("/");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en",
    );
  });
});
