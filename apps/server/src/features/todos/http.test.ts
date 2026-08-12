import { assert, it } from "@effect/vitest";
import { TodosApiGroup } from "@xsblx/api/todos/group";
import type { TodoStatus } from "@xsblx/api/todos/schema";
import { TodoCursor } from "@xsblx/api/todos/schema";
import { Effect, Result, Schema } from "effect";

/**
 * The endpoint's query schema, as `HttpApiEndpoint` built it — the field record
 * from `packages/api` after `toCodecStringTree` has derived the string parsing.
 * Asserting on the built schema rather than the source fields is the point: what
 * a request actually decodes to is the contract, and the derivation is where it
 * could silently drift.
 *
 * No database, so these run without the `layer(...)` wrapper the service tests use.
 */
// `endpoint.query` is erased to `Schema.Top | undefined`, so the decoded shape is
// restated here. It is the assertion, not a convenience: this is the contract the
// handler is written against.
const listQuery = TodosApiGroup.endpoints.list.query as unknown as Schema.Codec<
  { readonly status: TodoStatus; readonly limit: number; readonly cursor?: TodoCursor },
  unknown
>;

const decode = (input: unknown) => Schema.decodeUnknownEffect(listQuery)(input).pipe(Effect.result);

it.effect("applies the query defaults when nothing is supplied", () =>
  Effect.gen(function* () {
    const result = yield* decode({});
    assert.deepStrictEqual(Result.getOrThrow(result), { status: "all", limit: 20 });
  }),
);

it.effect("parses query strings into the decoded types", () =>
  Effect.gen(function* () {
    const cursor = "2026-08-12T09:30:00.000Z|V1StGXR8Z5jdHi6BmyTaP";
    const result = yield* decode({ status: "done", limit: "5", cursor });
    assert.deepStrictEqual(Result.getOrThrow(result), {
      status: "done",
      limit: 5,
      cursor: TodoCursor.make(cursor),
    });
  }),
);

it.effect("rejects a malformed cursor", () =>
  Effect.gen(function* () {
    // A bare id: valid before the sort key became `(createdAt, id)`, and now
    // meaningless. It must fail decoding rather than silently page from the start.
    const result = yield* decode({ cursor: "V1StGXR8Z5jdHi6BmyTaP" });
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects a page size past the cap", () =>
  Effect.gen(function* () {
    const result = yield* decode({ limit: "500" });
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects an unknown status", () =>
  Effect.gen(function* () {
    const result = yield* decode({ status: "nope" });
    assert.strictEqual(result._tag, "Failure");
  }),
);
