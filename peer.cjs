// Preload (node --require ./peer.cjs): records each request's TCP peer address in x-peer-address before Next.js sees
// the request, overwriting any value the client sent. Next.js passes on only headers, and fills X-Forwarded-For from
// the socket only when the client sent none, so without this the app cannot tell a trusted proxy from a client
// that forged the header (ADR auth-and-sign-in-throttling D1, deviation 2; src/server/request.ts reads it).
// It patches Node.js's http.Server.prototype.emit; test/integration/actions.test.ts checks it still takes effect
// after a Node.js or Next.js upgrade.
const http = require("node:http");

const HEADER = "x-peer-address";
const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, request, ...rest) {
  if (event === "request" && request?.headers) {
    request.headers[HEADER] = request.socket?.remoteAddress ?? "";
  }
  return emit.call(this, event, request, ...rest);
};
