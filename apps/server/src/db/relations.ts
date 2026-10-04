import { defineRelations } from "drizzle-orm";

import { user } from "../features/auth/schema.ts";
import { todos } from "../features/todos/schema.ts";

/**
 * Spike (yielded-auth branch): imports the two related tables directly
 * instead of the schema barrel. The barrel now also exports yielded's
 * generated tables, whose module chain leads back to `Db` — routing relations
 * through it would make `Db`'s own type circular.
 *
 * Better-auth's `session`/`account`/`verification` tables are gone —
 * destructive-forward, no legacy tables, no dual-write.
 */
export const relations = defineRelations({ user, todos }, (r) => ({
  user: {
    todos: r.many.todos(),
  },
  todos: {
    user: r.one.user({ from: r.todos.userId, to: r.user.id, optional: false }),
  },
}));
