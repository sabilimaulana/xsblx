import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { user } from "../auth/schema.ts";

export const todos = pgTable(
  "todos",
  {
    id: text().primaryKey().$defaultFn(newId),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text().notNull(),
    completed: boolean().notNull().default(false),
    // Millisecond precision on purpose: this column is half the keyset cursor,
    // and the cursor round-trips through a JS `Date`. At the default microsecond
    // precision a stored value sorts after its own ms-truncated cursor, and the
    // last row of every page comes back again on the next one.
    createdAt: timestamp({ withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  // Every read is scoped by owner and paged newest-first by `(createdAt, id)`,
  // so the index carries all three in that order: Postgres seeks straight to the
  // cursor and walks backwards, no sort and no offset scan. `id` breaks ties
  // within a millisecond — a nanoid carries no ordering of its own, it only has
  // to be deterministic. `completed` is deliberately not in the index — it is a
  // residual filter over one page's worth of rows.
  (table) => [
    index("todos_userId_createdAt_id_idx").on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
