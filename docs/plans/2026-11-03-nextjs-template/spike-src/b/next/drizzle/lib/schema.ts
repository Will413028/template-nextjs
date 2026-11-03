// Go template's users/items/sessions (baseline + items_owner_cascade) expressed in drizzle-orm 0.45.
import { sql } from "drizzle-orm";
import { boolean, check, customType, index, pgTable, primaryKey, text, timestamp, uniqueIndex, unique, uuid } from "drizzle-orm/pg-core";

// drizzle-orm 0.45 has no built-in bytea column; customType is the documented escape hatch.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    account: text("account").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    isDisabled: boolean("is_disabled").notNull().default(false),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("users_account_key").on(t.account),
    check("users_account_check", sql`(${t.account} = lower(${t.account})) AND (char_length(${t.account}) >= 3 AND char_length(${t.account}) <= 50)`),
    check("users_role_check", sql`${t.role} = ANY (ARRAY['admin'::text, 'user'::text])`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("items_owner_id_id_idx").on(t.ownerId, t.id.desc().nullsFirst()),
    check("items_title_check", sql`char_length(${t.title}) >= 1 AND char_length(${t.title}) <= 200`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    id: uuid("id").notNull().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: tstz("created_at").notNull(),
    lastUsedAt: tstz("last_used_at").notNull(),
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("sessions_id_key").on(t.id),
    index("sessions_user_id_id_idx").on(t.userId, t.id.desc().nullsFirst()),
    check("sessions_token_hash_check", sql`octet_length(${t.tokenHash}) = 32`),
  ],
);
