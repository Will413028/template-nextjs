import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { isDevelopment } from "@/lib/env";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { requestIdFor } from "@/server/request";

const intlMiddleware = createMiddleware(routing);

// Next.js renders inline scripts to boot the page, so script-src needs this request's nonce: Next reads it from the
// request's CSP header and puts it on its scripts (Next.js guide "Content Security Policy"). Without it no page ever
// hydrates and forms fall back to a plain submit.
export function cspFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Go's http.CrossOriginProtection (ADR auth-and-sign-in-throttling D1, deviation 1): Sec-Fetch-Site decides when a
// browser sends it; otherwise the Origin's host must equal Host. Never X-Forwarded-Host: Next.js believes it from any
// client that reaches it directly (the initial spikes checked). A request with neither header is not from a browser, so
// it carries no victim's cookie, and passes. Next.js's own Origin check on Server Actions stays as a second layer.
export function crossOrigin(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    // "null" (a sandboxed or privacy-sensitive context) and anything else that is not a URL
    return true;
  }
}

// The paths next-intl routes and the CSP covers: pages, not /api, /_next or files.
const PAGE = /^\/(?!api(?:\/|$)|_next(?:\/|$)|.*\..*)/;

// Proxy (Next.js 16's name for middleware, Node.js runtime): the request's id, cross-origin protection on every path,
// then locale routing and a fresh CSP nonce for pages. Every response says its request id in X-Request-ID.
export default function proxy(request: NextRequest) {
  const requestId = requestIdFor(request.headers);
  const response = route(request, requestId);
  response.headers.set("X-Request-ID", requestId);
  return response;
}

function route(request: NextRequest, requestId: string): NextResponse {
  if (crossOrigin(request)) {
    return new NextResponse("cross-origin request", { status: 403 });
  }
  // rendering, Route Handlers and Server Actions read the id from here; a client's own value is replaced
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  if (!PAGE.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  // next dev needs eval and its own inline scripts; the policy is for builds.
  if (isDevelopment()) {
    return intlMiddleware(new NextRequest(request, { headers }));
  }

  const csp = cspFor(btoa(crypto.randomUUID()));
  headers.set("Content-Security-Policy", csp);
  const response = intlMiddleware(new NextRequest(request, { headers }));
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Every path but the build's static files: a Server Action can be posted to any path, one that does not exist
  // included (the initial spikes checked), so the cross-origin check cannot be limited to pages.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
