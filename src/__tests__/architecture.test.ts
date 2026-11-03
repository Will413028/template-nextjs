import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type IViolation } from "dependency-cruiser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../.dependency-cruiser.cjs";

// The rules in .dependency-cruiser.cjs match resolved paths, which pnpm puts under node_modules/.pnpm/: a pattern
// that misses that layout passes everything silently. These fixtures break each package rule on purpose and run
// the real rule set over them. They are written under src/ for the duration of the test and removed afterwards.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ID = `archfixture${process.pid}`;
const FIXTURES: Record<string, string> = {
  [`src/lib/${ID}.ts`]: 'import pg from "pg";\nexport const x = pg;\n',
  [`src/app/${ID}.ts`]:
    'import { drizzle } from "drizzle-orm/node-postgres";\nexport const x = drizzle;\n',
  [`src/features/${ID}/components/widget.ts`]:
    'import pg from "pg";\nexport const x = pg;\n',
  [`src/features/${ID}/schema.ts`]:
    'import { sql } from "drizzle-orm";\nimport { pgTable, uuid } from "drizzle-orm/pg-core";\nexport const t = pgTable("t", { id: uuid("id").default(sql`uuidv7()`) });\n',
  [`src/features/${ID}x/schema.ts`]:
    'import { drizzle } from "drizzle-orm/node-postgres";\nexport const x = drizzle;\n',
};

let violations: IViolation[] = [];

beforeAll(async () => {
  for (const [file, text] of Object.entries(FIXTURES)) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true });
    writeFileSync(join(ROOT, file), text);
  }
  try {
    const result = await cruise(Object.keys(FIXTURES), {
      ruleSet: { forbidden: config.forbidden },
      validate: true,
      doNotFollow: { path: "node_modules" },
      tsPreCompilationDeps: true,
      baseDir: ROOT,
    });
    if (typeof result.output === "string") throw new Error(result.output);
    violations = result.output.summary.violations;
  } finally {
    rmSync(join(ROOT, `src/lib/${ID}.ts`), { force: true });
    rmSync(join(ROOT, `src/app/${ID}.ts`), { force: true });
    rmSync(join(ROOT, `src/features/${ID}`), { recursive: true, force: true });
    rmSync(join(ROOT, `src/features/${ID}x`), { recursive: true, force: true });
  }
}, 60_000);

afterAll(() => {
  violations = [];
});

const broken = (from: string) =>
  violations.filter((v) => v.from === from).map((v) => v.rule.name);

describe("dependency rules", () => {
  it("keep the pg driver out of shared code", () => {
    expect(broken(`src/lib/${ID}.ts`)).toContain(
      "database-only-from-server-code",
    );
  });

  it("keep drizzle's driver out of routes other than the health check", () => {
    expect(broken(`src/app/${ID}.ts`)).toContain(
      "database-only-from-server-code",
    );
  });

  it("keep the database out of a feature's components", () => {
    expect(broken(`src/features/${ID}/components/widget.ts`)).toContain(
      "database-only-from-server-code",
    );
  });

  it("let a schema use drizzle's table builders and sql", () => {
    expect(broken(`src/features/${ID}/schema.ts`)).toEqual([]);
  });

  it("keep drivers out of a schema", () => {
    expect(broken(`src/features/${ID}x/schema.ts`)).toContain(
      "database-only-from-server-code",
    );
  });
});
