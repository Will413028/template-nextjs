import "server-only";
import { randomUUIDv7 } from "node:crypto";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { clientIP, isTrusted, type Prefix, parsePrefix } from "./client-ip";
import { trustedProxyConfig } from "./env";

// Who sent the request, for every feature: the client's address behind trusted proxies and the request's id. Both
// believe a header only from a trusted proxy, so they share the TRUSTED_PROXIES list (Go: the middleware package).

// Written by peer.cjs, the preload that records the TCP peer before Next.js runs
// (ADR auth-and-sign-in-throttling D1, deviation 2); it overwrites any value a client sends. peer.test.ts checks the
// two names match.
export const PEER_HEADER = "x-peer-address";

// On globalThis: Next.js may bundle this module into more than one server chunk.
const KEY = Symbol.for("server.trustedProxies");
const store = globalThis as unknown as Record<symbol, Prefix[] | undefined>;

// TRUSTED_PROXIES, parsed once (a value that does not parse throws on every call).
export function trustedProxies(): Prefix[] {
  store[KEY] ??= trustedProxyConfig().map((prefix) => {
    try {
      return parsePrefix(prefix);
    } catch (error) {
      // the setting's name in the message, so a failed start says which value to fix
      throw new Error(`TRUSTED_PROXIES: ${(error as Error).message}`, {
        cause: error,
      });
    }
  });
  return store[KEY];
}

// Whether the TCP peer the preload recorded is a trusted proxy.
function fromTrustedProxy(headers: Headers): boolean {
  const peer = headers.get(PEER_HEADER);
  const trusted = trustedProxies();
  return peer !== null && isTrusted(peer, trusted);
}

// The client's address: the TCP peer, or behind a trusted proxy the address it forwarded (client-ip.ts).
// An action posted to a page that does not bundle it is forwarded by Next.js to itself over loopback, so its peer is
// 127.0.0.1. Never list loopback in TRUSTED_PROXIES, or a forwarded request's X-Forwarded-For would be believed with
// the real peer gone. The app's own forms post to the page that bundles the action and are never forwarded.
export async function requestClientIP(): Promise<string> {
  const h = await headers();
  const peer = h.get(PEER_HEADER);
  const ip = peer
    ? clientIP(peer, [h.get("x-forwarded-for") ?? ""], trustedProxies())
    : null;
  if (!ip) {
    // without the preload every client would share one address, or pick its own through X-Forwarded-For
    throw new Error(
      `${PEER_HEADER} is missing: start Node.js with --require ./peer.cjs`,
    );
  }
  return ip;
}

// A request id a proxy may set: it goes into log lines and a response header (Go middleware.go validRequestID).
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

// For proxy.ts, once per request (Go middleware.go withRequestInfo): the id a trusted proxy sent, when well formed,
// or a new UUIDv7. TRUSTED_PROXIES is read on every request, an id or not: a value that does not parse fails every
// response, the health check's included, where Go refuses to start. An action Next.js forwards to itself over
// loopback gets a new id here, so its log lines do not carry the id its client received.
export function requestIdFor(headers: Headers): string {
  const trusted = fromTrustedProxy(headers);
  const sent = headers.get(REQUEST_ID_HEADER);
  return trusted && sent && VALID_REQUEST_ID.test(sent) ? sent : randomUUIDv7();
}
