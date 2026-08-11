import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth/schema.ts";

export const todos = pgTable(
  "todos",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text().notNull(),
    completed: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Every read is scoped by owner and paged newest-first by id, so the index
  // carries both columns in that order: Postgres seeks straight to the cursor
  // and walks backwards, no sort and no offset scan. `completed` is deliberately
  // not in the index — it is a residual filter over one page's worth of rows.
  (table) => [index("todos_userId_id_idx").on(table.userId, table.id.desc())],
);
