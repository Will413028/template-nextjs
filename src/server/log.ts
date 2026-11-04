import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// One line of JSON per security event (ADR account-abuse-and-lifecycle D2b), with the id of the request that caused
// it (Go logx.WithRequestID): the same id is the response's X-Request-ID, which Caddy's access log records. Never pass
// a password, a token or a submitted username that matched no account: it can be a password typed into the wrong
// field.

export type SecurityLog = (
  event: string,
  fields: Record<string, string>,
) => void;

// On globalThis: Next.js may bundle this module into more than one server chunk, and the action wrapper that sets the
// id and the service that logs must share one store.
const KEY = Symbol.for("server.requestId");
const store = globalThis as unknown as Record<
  symbol,
  AsyncLocalStorage<string> | undefined
>;
store[KEY] ??= new AsyncLocalStorage<string>();
const requestIds = store[KEY];

// Runs an action with the request's id in scope for every line it logs.
export function withRequestId<T>(id: string | null, run: () => T): T {
  return id ? requestIds.run(id, run) : run();
}

export const securityLog: SecurityLog = (event, fields) => {
  const requestId = requestIds.getStore();
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      event,
      ...(requestId && { request_id: requestId }),
      ...fields,
    }),
  );
};
