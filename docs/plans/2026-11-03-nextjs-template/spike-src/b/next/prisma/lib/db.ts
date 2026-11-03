import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL }), log: ["query"] });
