// Non-browser Server Action client: reads action IDs from the build manifest, POSTs like the React client does,
// carries cookies by hand, returns status, Set-Cookie and the decoded action result.
import { readFileSync } from "node:fs";

type Manifest = { node: Record<string, { filename?: string; exportedName?: string; workers: Record<string, unknown> }> };

export function actionIds(manifestJson: string): Record<string, string> {
  const m = JSON.parse(manifestJson) as Manifest;
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(m.node)) out[`${v.filename}#${v.exportedName}`] = id;
  return out;
}
export const actionIdsFromDir = (nextDir: string) =>
  actionIds(readFileSync(`${nextDir}/server/server-reference-manifest.json`, "utf8"));

export type ActionResponse = { status: number; setCookie: string[]; result: unknown; raw: string };

export async function callAction(opts: {
  base: string; path?: string; id: string; args?: unknown[]; cookie?: string; headers?: Record<string, string>;
}): Promise<ActionResponse> {
  const res = await fetch(opts.base + (opts.path ?? "/"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "Next-Action": opts.id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: JSON.stringify(opts.args ?? []),
  });
  const raw = await res.text();
  return { status: res.status, setCookie: res.headers.getSetCookie(), result: decodeResult(raw), raw };
}

/** The RSC row 0 carries {"a":"$@N"}; row N is the action's return value (JSON). */
function decodeResult(raw: string): unknown {
  const rows = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) rows.set(line.slice(0, i), line.slice(i + 1));
  }
  const r0 = rows.get("0");
  const ref = r0?.match(/"a":"\$@([0-9a-f]+)"/)?.[1];
  const row = ref ? rows.get(ref) : undefined;
  if (row === undefined) return undefined;
  if (row.startsWith("E")) return { $error: row.slice(1) };
  try {
    return unescape$(JSON.parse(row));
  } catch {
    return row;
  }
}

/** React Flight escapes user strings starting with "$" as "$$". */
function unescape$(v: unknown): unknown {
  if (typeof v === "string") return v.startsWith("$$") ? v.slice(1) : v;
  if (Array.isArray(v)) return v.map(unescape$);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unescape$(x)]));
  return v;
}

export const cookieValue = (setCookie: string[], name: string) =>
  setCookie.map((c) => c.match(new RegExp(`^${name}=([^;]*)`))?.[1]).find((v) => v !== undefined);

export async function effects(base: string): Promise<{ effects: { action: string; tag: string }[]; sessions: number }> {
  return (await fetch(base + "/spike/effects")).json();
}
export async function reset(base: string) {
  await fetch(base + "/spike/effects", { method: "DELETE" });
}
export async function advanceClock(base: string, ms: number) {
  await fetch(base + "/spike/effects", { method: "PATCH", body: String(ms) });
}
