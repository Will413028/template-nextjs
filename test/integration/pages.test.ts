import { afterAll, beforeAll, describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zhTW from "../../messages/zh-TW.json";
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

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  server = await startNext({
    DATABASE_URL: database.url(APP),
    DATABASE_PASSWORD_FILE: database.appPasswordFile,
    TRUSTED_PROXIES: "",
    AUTH_RATE_LIMIT_PER_MIN: "1000",
  });
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
