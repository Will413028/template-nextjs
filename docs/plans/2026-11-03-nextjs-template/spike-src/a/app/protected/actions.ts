"use server";
import { record } from "@/lib/store";
import { requireSession } from "@/lib/session";

/** Relies on the page / proxy for auth (the anti-pattern under test). */
export async function protectedUnguarded(tag: string) {
  record("protectedUnguarded", tag);
  return "done";
}

/** Checks the session itself. */
export async function protectedGuarded(tag: string) {
  const account = await requireSession();
  record("protectedGuarded", `${account}:${tag}`);
  return "done";
}
