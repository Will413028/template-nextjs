// Preload (node -r ./peer.cjs): stamps the TCP peer address on every request before Next sees it, overwriting
// any client-sent value. Gives the app the Go-style "is the peer a trusted proxy?" input that Next hides
// (Next only sets x-forwarded-for when absent).
const http = require("node:http");
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (ev, req, ...rest) {
  if (ev === "request" && req && req.socket) req.headers["x-spike-peer"] = req.socket.remoteAddress || "";
  return emit.call(this, ev, req, ...rest);
};
