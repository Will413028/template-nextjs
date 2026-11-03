import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { migrateDatabase } from "../../scripts/migrate.mts";

// The same image (digest) as docker-compose.yml and the same role setup (deploy/postgres/initdb/10-roles.sh), so
// the tests see the production permissions: migrations as the owner, queries as the app role.
const IMAGE =
  "postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336";
const ROLES_SCRIPT = fileURLToPath(
  new URL("../../deploy/postgres/initdb/10-roles.sh", import.meta.url),
);

const DATABASE = "template_nextjs";
export const OWNER = "template_nextjs_owner";
export const APP = "template_nextjs_app";

export type TestDatabase = {
  container: StartedPostgreSqlContainer;
  // postgres://<role>@host:port/db, without the password, as the app reads DATABASE_URL
  url: (role: string) => string;
  ownerPassword: string;
  appPassword: string;
  // a file holding the app role's password, as the app reads DATABASE_PASSWORD_FILE
  appPasswordFile: string;
  stop: () => Promise<void>;
};

export async function startDatabase(): Promise<TestDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "template-nextjs-db-"));
  const ownerPassword = randomBytes(16).toString("hex");
  const appPassword = randomBytes(16).toString("hex");
  writeFileSync(join(dir, "db_owner_password"), `${ownerPassword}\n`);
  writeFileSync(join(dir, "db_app_password"), `${appPassword}\n`);

  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase(DATABASE)
    .withEnvironment({ DB_OWNER_USER: OWNER, DB_APP_USER: APP })
    .withCopyFilesToContainer([
      {
        source: ROLES_SCRIPT,
        target: "/docker-entrypoint-initdb.d/10-roles.sh",
        mode: 0o755,
      },
      {
        source: join(dir, "db_owner_password"),
        target: "/run/secrets/db_owner_password",
      },
      {
        source: join(dir, "db_app_password"),
        target: "/run/secrets/db_app_password",
      },
    ])
    .start();

  const url = (role: string) =>
    `postgres://${role}@${container.getHost()}:${container.getMappedPort(5432)}/${DATABASE}`;
  return {
    container,
    url,
    ownerPassword,
    appPassword,
    appPasswordFile: join(dir, "db_app_password"),
    stop: async () => {
      // a test may already have stopped it to simulate an outage
      await container.stop().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function migrateAsOwner(database: TestDatabase): Promise<void> {
  await migrateDatabase({
    connectionString: database.url(OWNER),
    password: database.ownerPassword,
    appRole: APP,
  });
}
