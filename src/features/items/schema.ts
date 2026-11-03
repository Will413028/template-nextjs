import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// relative: drizzle-kit does not resolve the "@/" alias
import { users } from "../auth/schema";

// The items feature's table (docs/rules/database-design.md), ported from template-go-nextjs modules/items/schema.sql.
// drizzle-kit loads this file outside Next.js, so it imports only drizzle-orm and the auth feature's tables.

// Items belong to their owner and go with the account. Titles are 1 to 200 code points (input.ts); a description has
// no limit, as in Go.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("items_title_check", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    // keyset pagination: WHERE owner_id = $1 AND id < $cursor ORDER BY id DESC (UUIDv7 ids sort by creation time)
    index("items_owner_id_id_idx").on(t.ownerId, t.id.desc().nullsFirst()),
  ],
);
