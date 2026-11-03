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

  it("sends a path without a locale to the default locale", () => {
    const response = get("/");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en",
    );
  });
});
