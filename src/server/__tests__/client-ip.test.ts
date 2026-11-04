import { describe, expect, it } from "vitest";
import { clientIP, parsePrefix } from "../client-ip";

// template-go-nextjs middleware_test.go TestClientIP, same table (proxies 172.30.0.0/24)
describe("clientIP", () => {
  const trusted = [parsePrefix("172.30.0.0/24")];
  it.each<[string, string, string[], string]>([
    [
      "untrusted peer ignores XFF",
      "203.0.113.7",
      ["198.51.100.9"],
      "203.0.113.7",
    ],
    ["trusted peer without XFF", "172.30.0.2", [], "172.30.0.2"],
    [
      "rightmost untrusted hop",
      "172.30.0.2",
      ["192.0.2.1, 198.51.100.9"],
      "198.51.100.9",
    ],
    [
      "skips trusted hops",
      "172.30.0.2",
      ["198.51.100.9, 172.30.0.3"],
      "198.51.100.9",
    ],
    [
      "several XFF headers",
      "172.30.0.2",
      ["192.0.2.1", "198.51.100.9"],
      "198.51.100.9",
    ],
    [
      "garbage stops at the last real hop",
      "172.30.0.2",
      ["198.51.100.9, garbage, 172.30.0.3"],
      "172.30.0.3",
    ],
    ["IPv4-mapped IPv6", "::ffff:172.30.0.2", ["198.51.100.9"], "198.51.100.9"],
  ])("%s", (_, peer, forwardedFor, want) => {
    expect(clientIP(peer, forwardedFor, trusted)).toBe(want);
  });

  it("reads an IPv4-mapped prefix as IPv6, as Go's netip does", () => {
    expect(parsePrefix("::ffff:0:0/96")).toMatchObject({ bits: 96, v6: true });
  });

  it("answers null for a peer that is not an address", () => {
    expect(clientIP("", [], trusted)).toBeNull();
  });

  it.each(["172.30.0.0", "172.30.0.0/33", "nope/24", "fd00::/129"])(
    "rejects the trusted-proxy prefix %j",
    (prefix) => {
      expect(() => parsePrefix(prefix)).toThrow("not an address prefix");
    },
  );
});
