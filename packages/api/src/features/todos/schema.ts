import { Effect, Schema } from "effect";

export const TodoId = Schema.Int.pipe(Schema.brand("TodoId"));
export type TodoId = typeof TodoId.Type;

// The message annotation is what a form renders on failure; without it the
// default formatter falls back to the filter's `expected` text.
const TodoTitle = Schema.String.check(Schema.isMinLength(1, { message: "Title is required" }));

export class Todo extends Schema.Class<Todo>("Todo")({
  id: TodoId,
  title: TodoTitle,
  completed: Schema.Boolean,
  // ISO string on the wire, `Date` in TypeScript. Deliberately not `DateTimeUtc`:
  // loader results are serialized to the browser, and the router's serializer
  // handles `Date` natively but rejects Effect's `DateTime.Utc` class.
  createdAt: Schema.DateFromString,
}) {}

export const TodoCreate = Schema.Struct({
  title: TodoTitle,
});

/**
 * The same schema the API validates against, exposed as a Standard Schema so
 * TanStack Form can drive client-side validation from it. There is one source of
 * truth for what a valid todo is — never restate these rules in the UI.
 */
export const TodoCreateStandard = Schema.toStandardSchemaV1(TodoCreate);

export const TodoUpdate = Schema.Struct({
  title: Schema.optional(TodoTitle),
  completed: Schema.optional(Schema.Boolean),
});

export const TodoStatus = Schema.Literals(["all", "open", "done"]);
export type TodoStatus = typeof TodoStatus.Type;

/** How many todos one page may hold — the ceiling a client cannot raise. */
export const TODO_PAGE_MAX = 100;
export const TODO_PAGE_DEFAULT = 20;

/**
 * Query params for `GET /todos`, as a field record — `HttpApiEndpoint` runs each
 * one through `Schema.toCodecStringTree`, so these are declared in terms of the
 * decoded type (`Int`, a literal union) and the string parsing is derived.
 *
 * Defaults live here rather than in the service: the handler then receives a
 * fully-populated query and has no shape of its own to invent, and OpenAPI
 * documents both the default and the bounds.
 */
export const TodoListQuery = {
  status: TodoStatus.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("all" as const))),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: TODO_PAGE_MAX })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(TODO_PAGE_DEFAULT)),
  ),
  // Keyset cursor: the id of the last todo on the previous page. Absent means
  // "from the start".
  cursor: Schema.optional(TodoId),
};

/**
 * One page of todos. `nextCursor` is `null` on the last page — a client pages by
 * following it, never by computing an offset.
 */
export class TodoPage extends Schema.Class<TodoPage>("TodoPage")({
  items: Schema.Array(Todo),
  nextCursor: Schema.NullOr(TodoId),
}) {}
