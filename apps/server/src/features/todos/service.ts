import { Todo, TodoId } from "@xsblx/api/todos/todo";
import { TodoNotFound, TodosError } from "@xsblx/api/todos/errors";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Drizzle, DrizzleLive } from "../../db/index.ts";
import { todos } from "./schema.ts";

type TodoRow = typeof todos.$inferSelect;

// Queries are Effects failing with SqlError. That is infrastructure failure, not a
// domain outcome, so it is `Effect.orDie`d rather than widening every caller's
// error channel.

/** The DB row shape is an implementation detail; the domain type is what leaves this module. */
const toDomain = (row: TodoRow): Todo =>
  new Todo({
    id: TodoId.make(row.id),
    title: row.title,
    completed: row.completed,
    createdAt: row.createdAt,
  });

/** A row only exists for its owner — the id alone is never enough to reach it. */
const owned = (userId: string, id: TodoId) => and(eq(todos.id, id), eq(todos.userId, userId));

/**
 * Every method takes the owner's id and every query filters on it. A todo belonging
 * to another user is indistinguishable from one that does not exist — `TodoNotFound`
 * rather than a "forbidden", so the API leaks nothing about other users' rows.
 */
export class Todos extends Context.Service<
  Todos,
  {
    list(userId: string): Effect.Effect<Array<Todo>, TodosError>;
    getById(userId: string, id: TodoId): Effect.Effect<Todo, TodosError>;
    create(userId: string, input: { readonly title: string }): Effect.Effect<Todo, TodosError>;
    update(
      userId: string,
      id: TodoId,
      input: { readonly title?: string | undefined; readonly completed?: boolean | undefined },
    ): Effect.Effect<Todo, TodosError>;
    remove(userId: string, id: TodoId): Effect.Effect<void, TodosError>;
  }
>()("server/Todos") {
  static readonly layer = Layer.effect(
    Todos,
    Effect.gen(function* () {
      const db = yield* Drizzle;

      const list = Effect.fn("Todos.list")(function* (userId: string) {
        const rows = yield* db
          .select()
          .from(todos)
          .where(eq(todos.userId, userId))
          .pipe(Effect.orDie);
        return rows.map(toDomain);
      });

      const getById = Effect.fn("Todos.getById")(function* (userId: string, id: TodoId) {
        yield* Effect.annotateCurrentSpan({ id });
        const rows = yield* db
          .select()
          .from(todos)
          .where(owned(userId, id))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) {
          return yield* new TodosError({ reason: new TodoNotFound({ id }) });
        }
        return toDomain(row);
      });

      const create = Effect.fn("Todos.create")(function* (
        userId: string,
        input: { readonly title: string },
      ) {
        const rows = yield* db
          .insert(todos)
          .values({ userId, title: input.title })
          .returning()
          .pipe(Effect.orDie);
        return toDomain(rows[0]!);
      });

      const update = Effect.fn("Todos.update")(function* (
        userId: string,
        id: TodoId,
        input: { readonly title?: string | undefined; readonly completed?: boolean | undefined },
      ) {
        const rows = yield* db
          .update(todos)
          .set(input)
          .where(owned(userId, id))
          .returning()
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) {
          return yield* new TodosError({ reason: new TodoNotFound({ id }) });
        }
        return toDomain(row);
      });

      const remove = Effect.fn("Todos.remove")(function* (userId: string, id: TodoId) {
        const rows = yield* db
          .delete(todos)
          .where(owned(userId, id))
          .returning({ id: todos.id })
          .pipe(Effect.orDie);
        if (rows.length === 0) {
          return yield* new TodosError({ reason: new TodoNotFound({ id }) });
        }
      });

      return Todos.of({ list, getById, create, update, remove });
    }),
  ).pipe(Layer.provide(DrizzleLive));
}
