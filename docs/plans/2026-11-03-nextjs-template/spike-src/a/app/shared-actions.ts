"use server";
import { record } from "@/lib/store";

/** Imported by both / (public) and /protected: present in both workers, so never forwarded. */
export async function sharedUnguarded(tag: string) {
  record("sharedUnguarded", tag);
  return "done";
}
