import type { TodoStatus } from "@xsblx/api/todos/schema";
import { Todo, TodoId, TodoPage } from "@xsblx/api/todos/schema";
import { TodoNotFound, TodosError } from "@xsblx/api/todos/errors";
import { and, desc, eq, lt } from "drizzle-orm";
import { Context, Effect, Layer, Metric } from "effect";
import { Drizzle, DrizzleLive } from "../../db/index.ts";
import { todos } from "./schema.ts";

type TodoRow = typeof todos.$inferSelect;

// Queries are Effects failing with SqlError. That is infrastructure failure, not a
// domain outcome, so it is `Effect.orDie`d rather than widening every caller's
// error channel.

/** The DB row shape is an implementation detail; the domain type is what leaves this module. */
const toDomain = (row: TodoRow): Todo =>
  Todo.make({
    id: TodoId.make(row.id),
    title: row.title,
    completed: row.completed,
    createdAt: row.createdAt,
  });

/**
 * A domain counter, and the only one this feature needs — spans already carry
 * per-call latency, so a metric earns its place only when the question is about
 * a total nobody can answer from a trace (ADR 0015).
 *
 * Nothing exports metrics unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; declaring
 * one is cheap and never fails.
 */
export const todosCreated = Metric.counter("todos_created_total", {
  description: "Todos successfully inserted.",
  incremental: true,
});

/** A row only exists for its owner — the id alone is never enough to reach it. */
const owned = (userId: string, id: TodoId) => and(eq(todos.id, id), eq(todos.userId, userId));

export type TodoListOptions = {
  readonly status: TodoStatus;
  readonly limit: number;
  readonly cursor?: TodoId | undefined;
};

/**
 * Every method takes the owner's id and every query filters on it. A todo belonging
 * to another user is indistinguishable from one that does not exist — `TodoNotFound`
 * rather than a "forbidden", so the API leaks nothing about other users' rows.
 */
export class Todos extends Context.Service<
  Todos,
  {
    list(userId: string, page: TodoListOptions): Effect.Effect<TodoPage, TodosError>;
    getById(userId: string, id: TodoId): Effect.Effect<Todo, TodosError>;
    create(userId: string, input: { readonly title: string }): Effect.Effect<Todo, TodosError>;
    update(
      userId: string,
      id: TodoId,
      input: { readonly title?: string | undefined; readonly completed?: boolean | undefined },
    ): Effect.Effect<Todo, TodosError>;
    remove(userId: string, id: TodoId): Effect.Effect<void, TodosError>;
  }
>()("server/features/todos/service/Todos") {
  static readonly layer = Layer.effect(
    Todos,
    Effect.gen(function* () {
      const db = yield* Drizzle;

      /**
       * Keyset pagination: the cursor is the last id of the previous page and
       * ordering is by id descending, which the `todos_userId_id_idx` index
       * serves directly. `OFFSET` is not used — it re-scans every skipped row,
       * so page 500 costs 500 pages of work and shifts under concurrent inserts.
       *
       * One row beyond `limit` is fetched to learn whether another page exists
       * without a second `COUNT` query.
       */
      const list = Effect.fn("Todos.list")(function* (userId: string, page: TodoListOptions) {
        yield* Effect.annotateCurrentSpan({ status: page.status, limit: page.limit });
        const rows = yield* db
          .select()
          .from(todos)
          .where(
            and(
              eq(todos.userId, userId),
              page.cursor === undefined ? undefined : lt(todos.id, page.cursor),
              page.status === "all" ? undefined : eq(todos.completed, page.status === "done"),
            ),
          )
          .orderBy(desc(todos.id))
          .limit(page.limit + 1)
          .pipe(Effect.orDie);

        const hasMore = rows.length > page.limit;
        const items = (hasMore ? rows.slice(0, page.limit) : rows).map(toDomain);
        return TodoPage.make({
          items,
          nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
        });
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
          return yield* TodosError.make({ reason: TodoNotFound.make({ id }) });
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
        // After the insert, so a failed write never counts as a creation.
        yield* Metric.update(todosCreated, 1);
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
          return yield* TodosError.make({ reason: TodoNotFound.make({ id }) });
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
          return yield* TodosError.make({ reason: TodoNotFound.make({ id }) });
        }
      });

      return Todos.of({ list, getById, create, update, remove });
    }),
  ).pipe(Layer.provide(DrizzleLive));
}
