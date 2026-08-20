import { desc, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { newId } from "../../id.ts";
import { user } from "../auth/schema.ts";

export const todos = sqliteTable(
  "todos",
  {
    id: text().primaryKey().$defaultFn(newId),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text().notNull(),
    completed: integer({ mode: "boolean" }).notNull().default(false),
    // Stored as epoch milliseconds, which is exactly the precision the keyset
    // cursor round-trips (`<ISO>|<id>`, ADR 0016) — there is no wider column type
    // to truncate against, so a stored value can never sort after its own cursor.
    // The default is SQLite's own clock rather than a JS one, so a row inserted
    // by a migration or by hand still gets a usable sort key. `unixepoch('subsec')`
    // is fractional seconds; the column holds milliseconds.
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
  },
  // Every read is scoped by owner and paged newest-first by `(createdAt, id)`, so
  // the index carries all three in that order: SQLite seeks straight to the
  // cursor and walks backwards, no sort and no offset scan. `id` breaks ties
  // within a millisecond — a nanoid carries no ordering of its own, it only has
  // to be deterministic. `completed` is deliberately not in the index — it is a
  // residual filter over one page's worth of rows.
  (table) => [
    index("todos_userId_createdAt_id_idx").on(table.userId, desc(table.createdAt), desc(table.id)),
  ],
);
