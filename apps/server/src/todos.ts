import { Todo, TodoId } from "@asshls/api/domain/todo";
import { TodoNotFound, TodosError } from "@asshls/api/domain/todo-errors";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Drizzle, DrizzleLive } from "./db/index.ts";
import { todos } from "./db/schema.ts";

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

export class Todos extends Context.Service<
  Todos,
  {
    list(): Effect.Effect<Array<Todo>, TodosError>;
    getById(id: TodoId): Effect.Effect<Todo, TodosError>;
    create(input: { readonly title: string }): Effect.Effect<Todo, TodosError>;
    update(
      id: TodoId,
      input: { readonly title?: string | undefined; readonly completed?: boolean | undefined },
    ): Effect.Effect<Todo, TodosError>;
    remove(id: TodoId): Effect.Effect<void, TodosError>;
  }
>()("server/Todos") {
  static readonly layer = Layer.effect(
    Todos,
    Effect.gen(function* () {
      const db = yield* Drizzle;

      const list = Effect.fn("Todos.list")(function* () {
        const rows = yield* db.select().from(todos).pipe(Effect.orDie);
        return rows.map(toDomain);
      });

      const getById = Effect.fn("Todos.getById")(function* (id: TodoId) {
        yield* Effect.annotateCurrentSpan({ id });
        const rows = yield* db
          .select()
          .from(todos)
          .where(eq(todos.id, id))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) {
          return yield* new TodosError({ reason: new TodoNotFound({ id }) });
        }
        return toDomain(row);
      });

      const create = Effect.fn("Todos.create")(function* (input: { readonly title: string }) {
        const rows = yield* db
          .insert(todos)
          .values({ title: input.title })
          .returning()
          .pipe(Effect.orDie);
        return toDomain(rows[0]!);
      });

      const update = Effect.fn("Todos.update")(function* (
        id: TodoId,
        input: { readonly title?: string | undefined; readonly completed?: boolean | undefined },
      ) {
        const rows = yield* db
          .update(todos)
          .set(input)
          .where(eq(todos.id, id))
          .returning()
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) {
          return yield* new TodosError({ reason: new TodoNotFound({ id }) });
        }
        return toDomain(row);
      });

      const remove = Effect.fn("Todos.remove")(function* (id: TodoId) {
        const rows = yield* db
          .delete(todos)
          .where(eq(todos.id, id))
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
