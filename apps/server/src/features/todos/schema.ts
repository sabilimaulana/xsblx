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
  // Every read is scoped by owner, so that is the access path to index.
  (table) => [index("todos_userId_idx").on(table.userId)],
);
