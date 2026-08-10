import { Schema } from "effect";

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
