import { Api } from "@xsblx/api/api";
import { CurrentUser } from "@xsblx/api/auth/middleware";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Todos } from "./service.ts";

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

    return (
      handlers
        // The query schema already applied its defaults and bounds, so the
        // handler passes it straight through — no shape of its own.
        .handle("list", ({ query }) =>
          Effect.flatMap(userId, (id) => todos.list(id, query)).pipe(Effect.orDie),
        )
        // `TodoNotFound` is the only reason the API models; anything else is a bug
        // and becomes a 500.
        .handle("getById", ({ params }) =>
          Effect.flatMap(userId, (id) => todos.getById(id, params.id)).pipe(
            Effect.catchReasons(
              "TodosError",
              { TodoNotFound: (reason) => Effect.fail(reason) },
              Effect.die,
            ),
          ),
        )
        .handle("create", ({ payload }) =>
          Effect.flatMap(userId, (id) => todos.create(id, payload)).pipe(Effect.orDie),
        )
        .handle("update", ({ params, payload }) =>
          Effect.flatMap(userId, (id) => todos.update(id, params.id, payload)).pipe(
            Effect.catchReasons(
              "TodosError",
              { TodoNotFound: (reason) => Effect.fail(reason) },
              Effect.die,
            ),
          ),
        )
        .handle("remove", ({ params }) =>
          Effect.flatMap(userId, (id) => todos.remove(id, params.id)).pipe(
            Effect.catchReasons(
              "TodosError",
              { TodoNotFound: (reason) => Effect.fail(reason) },
              Effect.die,
            ),
          ),
        )
    );
  }),
).pipe(Layer.provide(Todos.layer));
