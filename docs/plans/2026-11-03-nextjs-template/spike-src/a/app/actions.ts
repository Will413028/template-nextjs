"use server";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { headers } from "next/headers";
import { record, store } from "@/lib/store";
import { currentAccount, issueSession } from "@/lib/session";
import { authState, resolveClient, withHashSlot } from "@/lib/auth-state";

// ADR api-and-auth D6: argon2id m=19 MiB, t=2, p=1.
const PARAMS = { algorithm: Algorithm.Argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;

export async function ping(tag: string) {
  record("ping", tag);
  await issueSession("ping:" + tag);
  return "pong:" + tag;
}

export async function signUp(account: string, password: string) {
  const key = account.toLowerCase();
  if (store.users.has(key)) return { error: "account_taken" };
  const h = await withHashSlot(() => hash(password.normalize("NFKC"), PARAMS));
  store.users.set(key, { account: key, hash: h });
  record("signUp", key);
  await issueSession(key);
  return { ok: true };
}

export async function signIn(account: string, password: string) {
  const key = account.toLowerCase();
  const client = resolveClient(await headers());
  const st = authState();
  const ipWait = st.ip.wait(client.key);
  if (ipWait > 0) return { error: "rate_limited", retryAfter: Math.ceil(ipWait / 1000) };
  const wait = st.throttle.reserve(key, client.key); // counted before the hash, synchronously
  if (wait > 0) return { error: "login_throttled", retryAfter: Math.ceil(wait / 1000) };
  const user = store.users.get(key);
  dummyHash ??= hash("dummy password for unknown accounts", PARAMS);
  const ok = await withHashSlot(async () => {
    record("verify", key);
    return verify(user?.hash ?? (await dummyHash!), password.normalize("NFKC"));
  });
  if (!ok || !user) return { error: "invalid_credentials" };
  st.throttle.succeeded(key, client.key);
  record("signIn", key);
  await issueSession(key);
  return { ok: true };
}

export async function whoami() {
  return { account: await currentAccount(), client: resolveClient(await headers()) };
}

export async function argonInfo() {
  const t0 = performance.now();
  const encoded = await hash("correct horse battery staple", PARAMS);
  const ms = Math.round(performance.now() - t0);
  return {
    encoded,
    ms,
    verifyOk: await verify(encoded, "correct horse battery staple"),
    verifyBad: await verify(encoded, "correct horse battery stapler"),
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    libc: (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })?.header?.glibcVersionRuntime ?? "musl/none",
  };
}
