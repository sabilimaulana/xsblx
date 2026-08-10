import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { Todo, TodoCreate, TodoId, TodoUpdate } from "./todo.ts";
import { TodoNotFound } from "./errors.ts";
import { Authentication } from "../auth/middleware.ts";

/** Path params arrive as strings, so bridge into the branded id with `decodeTo`. */
const idParam = { id: Schema.FiniteFromString.pipe(Schema.decodeTo(TodoId)) };

export class TodosApiGroup extends HttpApiGroup.make("todos")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(Todo),
    }),
    HttpApiEndpoint.get("getById", "/:id", {
      params: idParam,
      success: Todo,
      error: TodoNotFound,
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: TodoCreate,
      success: Todo,
    }),
    HttpApiEndpoint.patch("update", "/:id", {
      params: idParam,
      payload: TodoUpdate,
      success: Todo,
      error: TodoNotFound,
    }),
    HttpApiEndpoint.delete("remove", "/:id", {
      params: idParam,
      success: Schema.Void,
      error: TodoNotFound,
    }),
  )
  // Every todo endpoint is scoped to the caller's session; the middleware adds
  // `Unauthorized` to each of them and provides `CurrentUser` to the handlers.
  .middleware(Authentication)
  .prefix("/todos")
  .annotateMerge(OpenApi.annotations({ title: "Todos" })) {}
