import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP,
  migrateAsOwner,
  startDatabase,
  type TestDatabase,
} from "./postgres";

let database: TestDatabase;

beforeAll(async () => {
  database = await startDatabase();
  await migrateAsOwner(database);
  // the route reads its configuration the way the compose app service provides it
  process.env.DATABASE_URL = database.url(APP);
  process.env.DATABASE_PASSWORD_FILE = database.appPasswordFile;
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

// in order: the second test stops the database
describe("GET /api/health", { shuffle: false }, () => {
  it("answers 200 and is never cached while the database is up", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 without details once the database is gone", async () => {
    const { GET } = await import("@/app/api/health/route");
    await database.container.stop();
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
