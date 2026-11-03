import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { store } from "./store";

export const COOKIE = "__Host-session";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function issueSession(account: string) {
  const token = randomBytes(32).toString("base64url"); // 43 chars, same shape as Go
  store.sessions.set(hash(token), { account, createdAt: Date.now() });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600,
  });
  return token;
}

/** Returns the account or null; never trusts anything but the cookie. */
export async function currentAccount(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return store.sessions.get(hash(token))?.account ?? null;
}

export async function requireSession(): Promise<string> {
  const a = await currentAccount();
  if (!a) throw new Error("unauthenticated");
  return a;
}
