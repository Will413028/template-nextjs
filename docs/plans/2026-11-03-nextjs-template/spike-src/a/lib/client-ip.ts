// Client address resolution, ported from Go backend/internal/httpapi/middleware.go trust.clientIP:
// the peer, unless the peer is a trusted proxy; then the first X-Forwarded-For hop from the right that is not
// trusted. A hop that does not parse stops the walk at the last address known to be real.
import { isIP } from "node:net";

export type Prefix = { addr: bigint; bits: number; v6: boolean };

function toBig(ip: string): { n: bigint; v6: boolean } | null {
  const kind = isIP(ip);
  if (kind === 4) {
    return { n: ip.split(".").reduce((a, p) => (a << 8n) | BigInt(Number(p)), 0n), v6: false };
  }
  if (kind !== 6) return null;
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  // embedded IPv4 tail
  const m = s.match(/(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = toBig(m[2])!.n;
    s = `${m[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return { n: groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g, 16)), 0n), v6: true };
}

/** Parses an address, unmapping ::ffff:a.b.c.d to IPv4 (Go netip Addr.Unmap). */
export function parseAddr(ip: string): { n: bigint; v6: boolean } | null {
  const a = toBig(ip.trim());
  if (!a) return null;
  if (a.v6 && a.n >> 32n === 0xffffn) return { n: a.n & 0xffffffffn, v6: false };
  return a;
}

export function fmt(a: { n: bigint; v6: boolean }): string {
  if (!a.v6) return [24n, 16n, 8n, 0n].map((s) => String((a.n >> s) & 0xffn)).join(".");
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(((a.n >> BigInt(i * 16)) & 0xffffn).toString(16));
  // WHATWG URL serializes IPv6 in RFC 5952 canonical form.
  return new URL(`http://[${g.join(":")}]`).hostname.slice(1, -1);
}

export function parsePrefix(p: string): Prefix {
  const [ip, bits] = p.split("/");
  const a = parseAddr(ip)!;
  return { addr: a.n, bits: Number(bits), v6: a.v6 };
}

function contains(p: Prefix, a: { n: bigint; v6: boolean }): boolean {
  if (p.v6 !== a.v6) return false;
  const width = a.v6 ? 128n : 32n;
  const shift = width - BigInt(p.bits);
  return a.n >> shift === p.addr >> shift;
}

export function clientIP(peer: string, xff: string[], trusted: Prefix[]): string {
  let addr = parseAddr(peer);
  if (!addr) return "unknown";
  if (!trusted.some((p) => contains(p, addr!))) return fmt(addr);
  const hops = xff.join(",").split(",");
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = parseAddr(hops[i]);
    if (!hop) return fmt(addr);
    addr = hop;
    if (!trusted.some((p) => contains(p, addr!))) return fmt(addr);
  }
  return fmt(addr);
}

/** Go ratelimit.go limitKey: IPv4 itself, IPv6 the first address of its /64. */
export function limitKey(ip: string): string {
  const a = parseAddr(ip);
  if (!a) return ip;
  if (!a.v6) return fmt(a);
  return fmt({ n: (a.n >> 64n) << 64n, v6: true });
}
