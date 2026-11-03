import { readFileSync } from "node:fs";

// A Server Action client without a browser (plan step 0 (a) §7): action ids from the build's manifest, a POST the
// way React's client sends one, cookies carried by hand, the action's result decoded from the RSC response.

type Manifest = {
  node: Record<string, { filename?: string; exportedName?: string }>;
};

// "<file>#<export>" for every action in the build. Ids change with every build, so they come from the build tested.
export function actionIds(nextDir = ".next"): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(`${nextDir}/server/server-reference-manifest.json`, "utf8"),
  ) as Manifest;
  return Object.fromEntries(
    Object.entries(manifest.node).map(([id, entry]) => [
      `${entry.filename}#${entry.exportedName}`,
      id,
    ]),
  );
}

// The id of the action called name, whichever feature's actions.ts exports it (the names are unique across features).
export function actionId(ids: Record<string, string>, name: string): string {
  const found = Object.entries(ids).filter(([key]) =>
    key.endsWith(`/actions.ts#${name}`),
  );
  const [entry] = found;
  if (found.length !== 1 || !entry) {
    throw new Error(`${found.length} actions named ${name} in the build`);
  }
  return entry[1];
}

export type ActionResponse = {
  status: number;
  setCookie: string[];
  // the X-Request-ID the response carries: the id its log lines have
  requestId: string | null;
  result: unknown;
};

export async function callAction(options: {
  base: string;
  id: string;
  args?: unknown[];
  // instead of args: a form's fields, sent as useActionState calls a form's action, (null, FormData)
  form?: Record<string, string>;
  path?: string;
  cookie?: string;
  headers?: Record<string, string>;
}): Promise<ActionResponse> {
  // a page that imports the actions' module: posted elsewhere, Next.js forwards the request to a page that does
  const response = await fetch(options.base + (options.path ?? "/en/sign-in"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "Next-Action": options.id,
      // a FormData body sets its own multipart Content-Type
      ...(options.form ? {} : { "Content-Type": "text/plain;charset=UTF-8" }),
      Accept: "text/x-component",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.form
      ? formReply(options.form)
      : JSON.stringify(options.args ?? []),
  });
  const raw = await response.text();
  return {
    status: response.status,
    setCookie: response.headers.getSetCookie(),
    requestId: response.headers.get("x-request-id"),
    result: decodeResult(raw),
  };
}

// What React's client posts for an action called with (previous state, FormData): the form's fields under the
// prefix "_1_", and the arguments, the FormData written as the reference "$K1", in part "0" (react-server-dom-webpack
// processReply, bundled with next 16.4.3; its server side decodeReply reads them back).
function formReply(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    body.append(`_1_${name}`, value);
  }
  body.set("0", JSON.stringify([null, "$K1"]));
  return body;
}

// Row 0 of the RSC payload carries {"a":"$@N"}; row N is the action's return value as JSON, or E<error> when it threw.
function decodeResult(raw: string): unknown {
  const rows = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) rows.set(line.slice(0, i), line.slice(i + 1));
  }
  const ref = rows.get("0")?.match(/"a":"\$@([0-9a-f]+)"/)?.[1];
  const row = ref ? rows.get(ref) : undefined;
  if (row === undefined) return undefined;
  if (row.startsWith("E")) return { thrown: row.slice(1) };
  return unescapeDollar(JSON.parse(row));
}

// React Flight writes a string that starts with "$" as "$$".
function unescapeDollar(value: unknown): unknown {
  if (typeof value === "string")
    return value.startsWith("$$") ? value.slice(1) : value;
  if (Array.isArray(value)) return value.map(unescapeDollar);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, unescapeDollar(v)]),
    );
  }
  return value;
}

// The Set-Cookie line for a cookie name, if the response set it.
export const setCookieLine = (setCookie: string[], name: string) =>
  setCookie.find((line) => line.startsWith(`${name}=`));

export const cookieValue = (setCookie: string[], name: string) =>
  setCookieLine(setCookie, name)?.match(/^[^=]+=([^;]*)/)?.[1];
