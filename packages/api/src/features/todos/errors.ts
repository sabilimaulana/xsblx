import { Schema } from "effect";
import { TodoId } from "./schema.ts";

export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()(
  "TodoNotFound",
  { id: TodoId },
  { httpApiStatus: 404 },
) {}

/**
 * Wrapper error for everything the Todos service can fail with.
 *
 * One wrapper per domain keeps service signatures and endpoint definitions from
 * accumulating a long union of error types. Add new cases to `reason`.
 */
export class TodosError extends Schema.TaggedError<TodosError>()("TodosError", {
  reason: Schema.Union([TodoNotFound]),
}) {}
