import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { Todo, TodoCreate, TodoId, TodoListQuery, TodoPage, TodoUpdate } from "./schema.ts";
import { TodoNotFound } from "./errors.ts";
import { Authentication } from "../auth/middleware.ts";

/** Ids are already strings on the wire, so the branded schema validates in place. */
const idParam = { id: TodoId };

export class TodosApiGroup extends HttpApiGroup.make("todos")
  .add(
    // Paginated by keyset, never offset, and the page size is capped by the
    // schema — an unbounded list endpoint is the shape that breaks first.
    HttpApiEndpoint.get("list", "/", {
      query: TodoListQuery,
      success: TodoPage,
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
