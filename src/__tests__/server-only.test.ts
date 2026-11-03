import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Server modules start with `import "server-only"`: a client component that reaches one, even through other modules,
// fails `next build` instead of shipping database or session code to the browser. dependency-cruiser checks direct
// imports; this marker covers the rest.
const SRC = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [relative(SRC, join(dir, entry.name))],
  );
}

const serverModule =
  /^(server\/.+|features\/[^/]+\/server\.ts|features\/[^/]+\/server\/.+)\.tsx?$/;

const serverModules = files(SRC).filter(
  (f) => serverModule.test(f) && !f.includes("__tests__"),
);

describe("server modules", () => {
  it("include the database and server configuration", () => {
    expect(serverModules).toEqual(
      expect.arrayContaining(["server/db.ts", "server/env.ts"]),
    );
  });

  it.each(serverModules)("%s imports server-only first", (file) => {
    const firstImport = readFileSync(join(SRC, file), "utf8")
      .split("\n")
      .find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "server-only";');
  });
});
