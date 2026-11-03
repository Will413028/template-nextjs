import "server-only";
import { isIP } from "node:net";

// The client's address behind trusted proxies, ported from template-go-nextjs middleware.go trust.clientIP: the
// peer, unless the peer is a trusted proxy; then the first X-Forwarded-For hop from the right that is not trusted.
// A hop that does not parse stops the walk at the last address known to be real. The peer comes from the preload
// that records the TCP peer before Next.js runs (plan D2 deviation 3, step 2b); Next.js itself only passes headers.

type Address = { n: bigint; v6: boolean };
export type Prefix = { address: bigint; bits: number; v6: boolean };

function parseIPv4(ip: string): bigint {
  return ip
    .split(".")
    .reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function toBigInt(raw: string): Address | null {
  const kind = isIP(raw);
  if (kind === 4) return { n: parseIPv4(raw), v6: false };
  if (kind !== 6) return null;
  let s = raw.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const tail = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = parseIPv4(tail[2] ?? "");
    s = `${tail[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = "", rest] = s.split("::");
  const front = head ? head.split(":") : [];
  const back = rest ? rest.split(":") : [];
  const groups =
    rest === undefined
      ? front
      : [
          ...front,
          ...Array<string>(8 - front.length - back.length).fill("0"),
          ...back,
        ];
  return {
    n: groups.reduce(
      (acc, g) => (acc << 16n) | BigInt(Number.parseInt(g, 16)),
      0n,
    ),
    v6: true,
  };
}

// Parses an address, unmapping ::ffff:a.b.c.d to IPv4 (Go netip Addr.Unmap).
function parseAddress(ip: string): Address | null {
  const a = toBigInt(ip.trim());
  if (a?.v6 && a.n >> 32n === 0xffffn)
    return { n: a.n & 0xffffffffn, v6: false };
  return a;
}

function format(a: Address): string {
  if (!a.v6) {
    return [24n, 16n, 8n, 0n].map((s) => String((a.n >> s) & 0xffn)).join(".");
  }
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((a.n >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  // the WHATWG URL parser prints IPv6 in RFC 5952's canonical form
  return new URL(`http://[${groups.join(":")}]`).hostname.slice(1, -1);
}

// "172.30.0.0/24" or "fd00::/64"; throws on anything else, so a bad TRUSTED_PROXIES fails at startup.
export function parsePrefix(prefix: string): Prefix {
  const [ip = "", bits = ""] = prefix.split("/");
  // not unmapped: ::ffff:0:0/96 is an IPv6 prefix, as Go's netip.ParsePrefix reads it
  const a = toBigInt(ip.trim());
  const n = Number(bits);
  if (!a || !/^\d+$/.test(bits) || n > (a.v6 ? 128 : 32)) {
    throw new Error(`not an address prefix: ${prefix}`);
  }
  return { address: a.n, bits: n, v6: a.v6 };
}

function contains(p: Prefix, a: Address): boolean {
  if (p.v6 !== a.v6) return false;
  const shift = BigInt((a.v6 ? 128 : 32) - p.bits);
  return a.n >> shift === p.address >> shift;
}

const inAny = (trusted: Prefix[], a: Address) =>
  trusted.some((p) => contains(p, a));

// Whether the address is one of the trusted proxies.
export function isTrusted(ip: string, trusted: Prefix[]): boolean {
  const address = parseAddress(ip);
  return address !== null && inAny(trusted, address);
}

export function clientIP(
  peer: string,
  forwardedFor: string[],
  trusted: Prefix[],
): string | null {
  let address = parseAddress(peer);
  if (!address) return null;
  if (!inAny(trusted, address)) return format(address);
  const hops = forwardedFor.join(",").split(",");
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = parseAddress(hops[i] ?? "");
    if (!hop) break;
    address = hop;
    if (!inAny(trusted, address)) break;
  }
  return format(address);
}

// The key a client is limited and throttled by (Go ratelimit.go limitKey): an IPv4 address itself, an IPv6 address
// the first address of its /64, which one subscriber usually holds whole.
export function limitKey(ip: string): string {
  const a = parseAddress(ip);
  if (!a) return ip;
  if (!a.v6) return format(a);
  return format({ n: (a.n >> 64n) << 64n, v6: true });
}
