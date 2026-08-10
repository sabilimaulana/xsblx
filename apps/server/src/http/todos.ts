import { Api } from "@xsblx/api/api";
import type { TodosError } from "@xsblx/api/domain/todo-errors";
import { CurrentUser } from "@xsblx/api/middleware/authentication";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Todos } from "../todos.ts";

/**
 * `TodoNotFound` is the only reason the API models; anything else is a bug and
 * becomes a 500.
 */
const notFoundOnly = <A, R>(effect: Effect.Effect<A, TodosError, R>) =>
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

    // `CurrentUser` comes from the Authentication middleware, so the owner is
    // never taken from the request body.
    const userId = Effect.map(CurrentUser, (user) => user.id);

    return handlers
      .handle("list", () => Effect.flatMap(userId, todos.list).pipe(Effect.orDie))
      .handle("getById", ({ params }) =>
        notFoundOnly(Effect.flatMap(userId, (id) => todos.getById(id, params.id))),
      )
      .handle("create", ({ payload }) =>
        Effect.flatMap(userId, (id) => todos.create(id, payload)).pipe(Effect.orDie),
      )
      .handle("update", ({ params, payload }) =>
        notFoundOnly(Effect.flatMap(userId, (id) => todos.update(id, params.id, payload))),
      )
      .handle("remove", ({ params }) =>
        notFoundOnly(Effect.flatMap(userId, (id) => todos.remove(id, params.id))),
      );
  }),
).pipe(Layer.provide(Todos.layer));
