import type { Instrumentation } from "next";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

// Once, when the server starts: every server setting is read and checked here, so a bad value stops the start
// instead of failing the first request that needs it (Go reads its configuration before it listens).
// Only in Node.js: Next.js also builds this file for the edge runtime, which has no node: modules; it inlines
// NEXT_RUNTIME, so the edge build drops the imports (Next.js instrumentation guide).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { authConfig, databaseConfig } = await import("@/server/env");
  const { trustedProxies } = await import("@/server/request");
  databaseConfig();
  authConfig();
  trustedProxies();
}

// An error no page, action or route caught: one line of JSON, in the shape of the security log, with the id the proxy
// gave the request, so the line can be matched with Caddy's access log (auth ADR D1, deviation 4). The error's message
// and stack stay out: they can hold submitted values; Next.js prints the stack to stderr itself.
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = Array.isArray(header) ? header[0] : header;
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String(error.digest)
      : undefined;
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      event: "request.error",
      ...(requestId && { request_id: requestId }),
      method: request.method,
      path: request.path,
      route_type: context.routeType,
      route: context.routePath,
      ...(digest && { digest }),
    }),
  );
};
