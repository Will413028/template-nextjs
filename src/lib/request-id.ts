// The header that carries the request's id: from Caddy to proxy.ts, from proxy.ts to rendering, actions and
// instrumentation.ts, and back to the client as X-Request-ID.
export const REQUEST_ID_HEADER = "x-request-id";
