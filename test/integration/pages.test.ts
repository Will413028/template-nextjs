import { afterAll, beforeAll, describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zhTW from "../../messages/zh-TW.json";
import { actionIds } from "./action-client";
import { signUpToSignOut, visitor } from "./flow";
import { type NextServer, startNext } from "./next-server";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

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
      expect(broken.logs.join("")).toContain("not an address prefix");
    } finally {
      await broken.stop();
    }
  });
});
