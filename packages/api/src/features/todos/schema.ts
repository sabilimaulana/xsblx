import { Effect, Schema } from "effect";
import { ID_ALPHABET, ID_LENGTH, IdString } from "../../id.ts";

export const TodoId = IdString.pipe(Schema.brand("TodoId"));
export type TodoId = typeof TodoId.Type;

/**
 * Keyset cursor for `GET /todos`, as `<createdAt ISO>|<id>`.
 *
 * A nanoid carries no ordering, so the sort key is `(createdAt, id)` and the
 * cursor has to carry both — the id alone breaks down the moment two todos share
 * a millisecond. The pattern is exact (`toISOString` has one form, and neither
 * half can contain `|`), so a cursor that decodes is safe to split.
 */
const TODO_CURSOR_PATTERN = new RegExp(
  `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\|[${ID_ALPHABET}]{${ID_LENGTH}}$`,
);

export const TodoCursor = Schema.String.check(
  Schema.isPattern(TODO_CURSOR_PATTERN, { message: "Malformed cursor" }),
).pipe(Schema.brand("TodoCursor"));
export type TodoCursor = typeof TodoCursor.Type;

export const todoCursor = (todo: { readonly createdAt: Date; readonly id: TodoId }): TodoCursor =>
  TodoCursor.make(`${todo.createdAt.toISOString()}|${todo.id}`);

/**
 * Splits a cursor back into its two halves. Safe because `TodoCursor` only
 * exists once the pattern above has matched.
 *
 * `createdAt` stays the ISO string it was encoded as. The only consumer parses it
 * to epoch milliseconds — the unit its column stores (ADR 0020) — and keeping the
 * wire format an instant rather than a number leaves a cursor readable in a log.
 */
export const todoCursorParts = (cursor: TodoCursor): { createdAt: string; id: TodoId } => {
  const [createdAt, id] = cursor.split("|") as [string, string];
  return { createdAt, id: TodoId.make(id) };
};

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
  // Keyset cursor: the sort key of the last todo on the previous page. Absent
  // means "from the start".
  cursor: Schema.optional(TodoCursor),
};

/**
 * One page of todos. `nextCursor` is `null` on the last page — a client pages by
 * following it, never by computing an offset.
 */
export class TodoPage extends Schema.Class<TodoPage>("TodoPage")({
  items: Schema.Array(Todo),
  nextCursor: Schema.NullOr(TodoCursor),
}) {}
