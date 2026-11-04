import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeCursor } from "@/features/items/server/cursor";
import en from "../../messages/en.json";
import zhTW from "../../messages/zh-TW.json";
import { actionId, actionIds, callAction } from "./action-client";
import { signUpToSignOut, visitor } from "./flow";
import { type NextServer, startNext } from "./next-server";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

// A message's text as a pattern that matches only that text.
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The pages against the production build (`next start` with the peer preload) and PostgreSQL as the app role.

let database: TestDatabase;
let server: NextServer;

const env = () => ({
  DATABASE_URL: database.url(APP),
  DATABASE_PASSWORD_FILE: database.appPasswordFile,
  TRUSTED_PROXIES: "",
  AUTH_RATE_LIMIT_PER_MIN: "1000",
});

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  // a server process in a zone that is not the app's (src/i18n/request.ts sets UTC), so a page that falls back to
  // the process's zone shows it
  server = await startNext({ ...env(), TZ: "Pacific/Auckland" });
}, 180_000);

afterAll(async () => {
  await server?.stop();
  await database?.stop();
});

// How many of the page's scripts there are, and how many carry the nonce of the response's own CSP: a script
// without it never runs, so a page where they differ never hydrates.
function scripts(response: Response, html: string) {
  const nonce = /'nonce-([^']+)'/.exec(
    response.headers.get("content-security-policy") ?? "",
  )?.[1];
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  return {
    total: tags.length,
    withNonce: tags.filter((tag) => nonce && tag.includes(`nonce="${nonce}"`))
      .length,
  };
}

// Next.js answers notFound() from a page rendered per request with an empty HTML shell and the not-found page in the
// RSC payload, which the browser renders once the scripts run (measured with next 16.4.3): so every script must run.
describe("an unknown path", () => {
  it.each([
    ["/en/no-such-page", en.notFound.title],
    ["/zh-TW/a/b/c", zhTW.notFound.title],
  ])(
    "%s answers 404 with the translated page, every script carrying the response's nonce",
    async (path, title) => {
      const response = await fetch(server.base + path);
      const html = await response.text();
      expect(response.status).toBe(404);
      expect(html).toContain(title);
      const { total, withNonce } = scripts(response, html);
      expect(total).toBeGreaterThan(0);
      expect(withNonce).toBe(total);
    },
  );
});

describe("the end-to-end flow", () => {
  it("signs up, signs in, shows the dashboard with the username, signs out and sends the user back to sign in", async () => {
    await signUpToSignOut(server.base, actionIds());
  });
});

describe("the settings page", () => {
  it("shows each session's times in the configured time zone, not the server process's", async () => {
    const user = visitor(server.base, actionIds());
    const username = `zone-${Date.now().toString(36)}`;
    expect(
      await user.act("signUp", [
        null,
        { username, password: "a long enough password" },
      ]),
    ).toEqual({ ok: true });
    const settings = await user.get("/en/settings");
    expect(settings.status).toBe(200);
    expect(settings.html).toMatch(/Signed in [^<]*UTC/);
  });
});

describe("the sign-in and sign-up pages", () => {
  it.each([
    ["/en/sign-in", en.auth.signInTitle],
    ["/zh-TW/sign-up", zhTW.auth.signUpTitle],
  ])(
    "%s renders its translated form, posted with POST, every script carrying the response's nonce",
    async (path, title) => {
      const response = await fetch(server.base + path);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain(title);
      // should the scripts not run, the browser posts the form itself: never the password in a URL
      expect(html).toMatch(/<form[^>]*method="POST"/);
      const { total, withNonce } = scripts(response, html);
      expect(total).toBeGreaterThan(0);
      expect(withNonce).toBe(total);
    },
  );
});

describe("a TRUSTED_PROXIES that does not parse", () => {
  it("fails every response, the health check's included, so the deployment never turns healthy", async () => {
    const broken = await startNext(
      { ...env(), TRUSTED_PROXIES: "not-an-ip" },
      (health) => health.status === 500,
    );
    try {
      expect((await fetch(`${broken.base}/en`)).status).toBe(500);
      // the cause, not only a 500: the same env with an empty TRUSTED_PROXIES is the healthy server the other tests use
      expect(broken.logs.join("")).toContain(
        "TRUSTED_PROXIES: not an address prefix: not-an-ip",
      );
    } finally {
      await broken.stop();
    }
  });
});

// The items pages and their forms, ported from template-go-nextjs httpapi/items_test.go where Go tested what a page
// or a form now does. The forms are posted
// as FormData, the way the browser posts them; test/integration/items.test.ts covers the queries case by case.
describe("the items pages", () => {
  const hex = () => randomBytes(4).toString("hex");

  async function signedIn() {
    const user = visitor(server.base, actionIds());
    expect(
      await user.act("signUp", [
        null,
        { username: `items-${hex()}`, password: "a long enough password" },
      ]),
    ).toEqual({ ok: true });
    return user;
  }

  // The new item's id, from what createItem answered.
  function createdId(result: unknown): string {
    const created = result as { ok?: boolean; item?: { id?: string } };
    if (!created.ok || !created.item?.id) {
      throw new Error(`no item created: ${JSON.stringify(result)}`);
    }
    return created.item.id;
  }

  it("let a user add an item, find it listed, change it and delete it, through the forms", async () => {
    const user = await signedIn();
    const title = `Buy milk ${hex()}`;
    const id = createdId(
      await user.submit(
        "createItem",
        { title, description: "two litres" },
        "/en/items",
      ),
    );
    const list = await user.get("/en/items");
    expect(list.status).toBe(200);
    expect(list.html).toContain(title);
    expect(list.html).toContain(`href="/en/items/${id}"`);
    const page = await user.get(`/en/items/${id}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain("two litres");
    // a form cannot send null: its empty description clears the item's
    expect(
      await user.submit(
        "updateItem",
        { id, title: "Buy oat milk", description: "" },
        `/en/items/${id}`,
      ),
    ).toMatchObject({
      ok: true,
      item: { id, title: "Buy oat milk", description: null },
    });
    expect(await user.submit("deleteItem", { id }, `/en/items/${id}`)).toEqual({
      ok: true,
    });
    expect((await user.get(`/en/items/${id}`)).status).toBe(404);
  });

  it("show a user none of another user's items: not listed, its page not found, and the forms change nothing", async () => {
    const alice = await signedIn();
    const bob = await signedIn();
    const title = `alice's ${hex()}`;
    const id = createdId(
      await alice.submit("createItem", { title, description: "" }, "/en/items"),
    );
    expect((await bob.get("/en/items")).html).not.toContain(title);
    expect((await bob.get(`/en/items/${id}`)).status).toBe(404);
    const notFound = { ok: false, code: "not_found" };
    expect(
      await bob.submit(
        "updateItem",
        { id, title: "bob was here", description: "" },
        "/en/items",
      ),
    ).toEqual(notFound);
    expect(await bob.submit("deleteItem", { id }, "/en/items")).toEqual(
      notFound,
    );
    const still = await alice.get(`/en/items/${id}`);
    expect(still.status).toBe(200);
    expect(still.html).toContain(title);
  });

  // A form whose action is a Server Action posts before the scripts load; a client function would render a
  // javascript: action the CSP blocks, and the form would do nothing
  it("render the add form posted to the server, not a script", async () => {
    const user = await signedIn();
    const { html } = await user.get("/en/items");
    expect(html).toMatch(/<form[^>]*method="POST"/);
    expect(html).not.toMatch(/<form[^>]*action="javascript:/);
  });

  // The form keeps what it sent in the browser (item-form.tsx): a refused action returns only what was wrong
  it("refuse a form without sending its fields back, and change nothing", async () => {
    const user = await signedIn();
    const long = "a".repeat(201);
    expect(
      await user.submit(
        "createItem",
        { title: long, description: "kept" },
        "/en/items",
      ),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      fields: { title: "too_long" },
    });
    const id = createdId(
      await user.submit(
        "createItem",
        { title: "saved", description: "" },
        "/en/items",
      ),
    );
    expect(
      await user.submit(
        "updateItem",
        { id, title: long, description: "changed" },
        `/en/items/${id}`,
      ),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      fields: { title: "too_long" },
    });
    const list = await user.get("/en/items");
    expect(list.html).toContain("saved");
    expect(list.html).not.toContain("kept");
    expect(list.html).not.toContain("changed");
  });

  it.each(["/en/items/42", "/en/items?cursor=not-a-cursor"])(
    "answers %s with not found",
    async (path) => {
      const user = await signedIn();
      expect((await user.get(path)).status).toBe(404);
    },
  );

  it("pages through the list: older items behind a next-page link, and a link back to the newest", async () => {
    const user = await signedIn();
    // item-00 is the oldest; a page holds 20, so it alone is on the second
    for (let i = 0; i <= 20; i++) {
      const title = `item-${String(i).padStart(2, "0")}`;
      createdId(
        await user.submit(
          "createItem",
          { title, description: "" },
          "/en/items",
        ),
      );
    }
    const first = await user.get("/en/items");
    expect(first.html).toContain("item-20");
    expect(first.html).not.toContain("item-00");
    // matched as elements: the client gets the whole catalog, so a bare message text is on every page
    const firstPageLink = new RegExp(
      `<a[^>]*href="/en/items"[^>]*>${literal(en.items.firstPage)}</a>`,
    );
    const addForm = new RegExp(`>${literal(en.items.newItem)}</h2>`);
    expect(first.html).toMatch(addForm);
    expect(first.html).not.toMatch(firstPageLink);
    const next = /href="(\/en\/items\?cursor=[A-Za-z0-9_-]+)"/.exec(
      first.html,
    )?.[1];
    if (!next) throw new Error("no next-page link on the first page");
    const second = await user.get(next);
    expect(second.status).toBe(200);
    expect(second.html).toContain("item-00");
    expect(second.html).not.toContain("item-01");
    // the link back to the newest, and no form to add one where it would not show
    expect(second.html).toMatch(firstPageLink);
    expect(second.html).not.toMatch(addForm);
    // past the oldest: no items, and the page says there are no older ones
    const oldest = /href="\/en\/items\/([0-9a-f-]{36})"/.exec(second.html)?.[1];
    if (!oldest) throw new Error("no item link on the second page");
    const past = await user.get(`/en/items?cursor=${encodeCursor(oldest)}`);
    expect(past.status).toBe(200);
    expect(past.html).toContain(`>${en.items.noOlder}</p>`);
    expect(past.html).not.toContain(`>${en.items.empty}</p>`);
  });

  it("sends a visitor without a session to sign in", async () => {
    const response = await fetch(`${server.base}/en/items`, {
      redirect: "manual",
    });
    expect(response.status).toBe(307);
    expect(
      new URL(response.headers.get("location") ?? "", server.base).pathname,
    ).toBe("/en/sign-in");
  });

  // CSRF (ADR api-and-auth-baseline D5): a cross-site request is refused before the action runs (src/proxy.ts).
  it("does not create an item from a cross-site request", async () => {
    const user = await signedIn();
    const title = `csrf ${hex()}`;
    const response = await callAction({
      base: server.base,
      id: actionId(actionIds(), "createItem"),
      form: { title, description: "" },
      path: "/en/items",
      cookie: `__Host-session=${user.session()}`,
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(response.status).toBe(403);
    expect((await user.get("/en/items")).html).not.toContain(title);
  });
});
