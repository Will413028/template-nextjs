import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// The auth feature's tables (docs/rules/database-design.md). drizzle-kit loads this file outside Next.js, so it
// imports only drizzle-orm.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Usernames are stored lowercased, so uniqueness and sign-in ignore case; the zod schema allows
// [A-Za-z0-9_.-]{3,50} (credentials.ts).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    username: text("username").notNull().unique("users_username_key"),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "users_username_check",
      sql`${t.username} = lower(${t.username}) AND char_length(${t.username}) BETWEEN 3 AND 50`,
    ),
  ],
);

// Opaque sessions: the cookie holds a random token, the table only its SHA-256, and every request looks a session
// up by token_hash. id is the identifier pages and actions use (the sessions list, revoking one), so nothing derived
// from the token leaves the server. The times come from the application's clock, so tests control expiry.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    id: uuid("id").notNull().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("sessions_token_hash_check", sql`octet_length(${t.tokenHash}) = 32`),
    uniqueIndex("sessions_id_key").on(t.id),
    // a user's sessions newest first (UUIDv7 ids sort by creation time), and deleting them all
    index("sessions_user_id_id_idx").on(t.userId, t.id.desc().nullsFirst()),
  ],
);
