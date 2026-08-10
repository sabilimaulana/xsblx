import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Todos } from "../src/todos.ts";

/**
 * Integration test: runs against the real Postgres from DATABASE_URL, because
 * the interesting part of `Todos` is the SQL, and a hand-rolled in-memory fake
 * would only test itself.
 */
layer(Todos.layer)("Todos", (it) => {
  it.effect("creates, reads, updates and removes", () =>
    Effect.gen(function* () {
      const todos = yield* Todos;

      const created = yield* todos.create({ title: "write the example slice" });
      assert.strictEqual(created.completed, false);

      const fetched = yield* todos.getById(created.id);
      assert.strictEqual(fetched.title, "write the example slice");

      const completed = yield* todos.update(created.id, { completed: true });
      assert.strictEqual(completed.completed, true);

      const listed = yield* todos.list();
      assert.isTrue(listed.some((todo) => todo.id === created.id));

      yield* todos.remove(created.id);

      const afterRemoval = yield* todos.getById(created.id).pipe(Effect.flip);
      assert.strictEqual(afterRemoval.reason._tag, "TodoNotFound");
    }),
  );

  it.effect("fails with TodoNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const todos = yield* Todos;
      const error = yield* todos.getById(-1 as never).pipe(Effect.flip);
      assert.strictEqual(error.reason._tag, "TodoNotFound");
    }),
  );
});
