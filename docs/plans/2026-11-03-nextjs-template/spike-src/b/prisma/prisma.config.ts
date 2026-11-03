import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? "", shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL },
});
