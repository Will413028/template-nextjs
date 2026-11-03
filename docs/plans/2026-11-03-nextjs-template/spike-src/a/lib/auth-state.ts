import "server-only";
import { availableParallelism } from "node:os";
import { IPLimiter, SignInThrottle } from "./throttle";
import { clientIP, limitKey, parsePrefix } from "./client-ip";

type State = { ip: IPLimiter; throttle: SignInThrottle; clockOffset: number };
const g = globalThis as unknown as { __spikeAuth?: State };
const clock = () => Date.now() + (g.__spikeAuth?.clockOffset ?? 0);
export function authState(): State {
  return (g.__spikeAuth ??= {
    ip: new IPLimiter(Number(process.env.SPIKE_AUTH_RATE_PER_MIN ?? 1000), clock),
    throttle: new SignInThrottle(clock),
    clockOffset: 0,
  });
}
export function resetAuthState() {
  delete g.__spikeAuth;
}

const trusted = (process.env.SPIKE_TRUSTED_PROXIES ?? "").split(",").filter(Boolean).map(parsePrefix);

/** Resolves the client address from request headers.
 *  peer: x-spike-peer, written by the preload (peer.cjs) from req.socket.remoteAddress, overwriting any client value.
 *  Without the preload there is no peer, and the only thing Next gives us is x-forwarded-for, which Next sets to the
 *  socket address ONLY when absent (base-server.js `??=`). */
export function resolveClient(h: Headers): { ip: string; key: string; via: string } {
  const peer = h.get("x-spike-peer");
  const xff = h.get("x-forwarded-for") ?? "";
  if (peer) {
    const ip = clientIP(peer, [xff], trusted);
    return { ip, key: limitKey(ip), via: "peer+trusted-proxies" };
  }
  // network-isolation mode: Next is reachable only from Caddy, which replaces XFF with the real peer.
  const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = hops.at(-1) ?? "unknown";
  return { ip, key: limitKey(ip), via: "rightmost-xff" };
}

// Bounded concurrent hashing (ADR api-and-auth D6). @node-rs/argon2 runs on the libuv pool as well.
let running = 0;
const waiters: (() => void)[] = [];
export const MAX_HASHES = Number(process.env.SPIKE_MAX_HASHES ?? availableParallelism());
export async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_HASHES) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}
