import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every Server Action is a public POST endpoint, reachable by its id from any path (plan step 0 (a) §4), so a page's
// own session check never covers it. These rules keep each action behind authedAction (a live session first) or, for
// the two operations a visitor without an account needs, publicAction (the per-IP limit first). The integration test
// test/integration/actions.test.ts calls every action of the build without a cookie.
const SRC = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [relative(SRC, join(dir, entry.name))],
  );
}

const sources = files(SRC)
  .filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"))
  .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));

// a "use server" directive at the top of a module, or inside a function body (an inline action)
const useServer = /^\s*["']use server["'];?\s*$/m;

const actionModules = sources.filter((s) => useServer.test(s.text));

// export const <name> = <wrapper>(
const exported = (text: string) =>
  [
    ...text.matchAll(
      /^export\s+(?:const|let|var|async function|function)\s+(\w+)/gm,
    ),
  ].map((m) => m[1]);
const wrapperOf = (text: string, name: string) =>
  new RegExp(`^export const ${name} = (\\w+)\\(`, "m").exec(text)?.[1];

const PUBLIC = [
  "features/auth/actions.ts#signUp",
  "features/auth/actions.ts#signIn",
];

describe("server actions", () => {
  it("live only in a feature's actions.ts, with the directive at the top", () => {
    expect(actionModules.length).toBeGreaterThan(0);
    for (const { file, text } of actionModules) {
      expect(file).toMatch(/^features\/[^/]+\/actions\.ts$/);
      expect(text.trimStart().startsWith('"use server";')).toBe(true);
    }
  });

  it("are each made by authedAction or publicAction, and only sign-up and sign-in are public", () => {
    const publicOnes: string[] = [];
    for (const { file, text } of actionModules) {
      const names = exported(text);
      expect(names.length).toBeGreaterThan(0);
      // every export is a wrapped const; `export async function` would skip the wrappers
      expect(text).not.toMatch(/^export\s+(async\s+)?function/m);
      expect(text).not.toMatch(/^export\s*\{/m);
      expect(text).not.toMatch(/^export\s+(let|var)\s/m);
      expect(text).not.toMatch(/^export\s+default/m);
      for (const name of names) {
        const wrapper = wrapperOf(text, name ?? "");
        expect(["authedAction", "publicAction"], `${file}#${name}`).toContain(
          wrapper,
        );
        if (wrapper === "publicAction") publicOnes.push(`${file}#${name}`);
      }
    }
    expect(publicOnes.sort()).toEqual([...PUBLIC].sort());
  });
});
