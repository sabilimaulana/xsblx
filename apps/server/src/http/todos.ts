import { Api } from "@asshls/api/api";
import type { TodosError } from "@asshls/api/domain/todo-errors";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Todos } from "../todos.ts";

/**
 * `TodoNotFound` is the only reason the API models; anything else is a bug and
 * becomes a 500.
 */
const notFoundOnly = <A>(effect: Effect.Effect<A, TodosError>) =>
  Effect.catchReasons(
    effect,
    "TodosError",
    {
      TodoNotFound: (reason) => Effect.fail(reason),
    },
    Effect.die,
  );

/**
 * Handlers translate between HTTP and the domain. Business rules live in the
 * `Todos` service; this layer only maps errors onto the endpoint's error type.
 */
export const TodosApiHandlers = HttpApiBuilder.group(
  Api,
  "todos",
  Effect.fn(function* (handlers) {
    const todos = yield* Todos;

    return handlers
      .handle("list", () => todos.list().pipe(Effect.orDie))
      .handle("getById", ({ params }) => notFoundOnly(todos.getById(params.id)))
      .handle("create", ({ payload }) => todos.create(payload).pipe(Effect.orDie))
      .handle("update", ({ params, payload }) => notFoundOnly(todos.update(params.id, payload)))
      .handle("remove", ({ params }) => notFoundOnly(todos.remove(params.id)));
  }),
).pipe(Layer.provide(Todos.layer));
