import type { Instrumentation } from "next";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

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
