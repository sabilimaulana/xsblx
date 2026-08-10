import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Drizzle, DrizzleLive } from "../../db/index.ts";
import { user } from "../auth/schema.ts";
import { Todos } from "./service.ts";

const OWNER = "test-user-owner";
const OTHER = "test-user-other";

/**
 * Todos are owned, so the owners have to exist before anything can be created.
 * Every test starts from a truncated database, so this reseeds each time.
 */
const seedUsers = Effect.gen(function* () {
  const db = yield* Drizzle;
  yield* db
    .insert(user)
    .values([OWNER, OTHER].map((id) => ({ id, name: id, email: `${id}@example.test` })))
    .pipe(Effect.orDie);
});

/**
 * Integration test: runs against the real Postgres from DATABASE_URL, because
 * the interesting part of `Todos` is the SQL, and a hand-rolled in-memory fake
 * would only test itself.
 */
layer(Layer.mergeAll(Todos.layer, DrizzleLive))("Todos", (it) => {
  it.effect("creates, reads, updates and removes", () =>
    Effect.gen(function* () {
      yield* seedUsers;
      const todos = yield* Todos;

      const created = yield* todos.create(OWNER, { title: "write the example slice" });
      assert.strictEqual(created.completed, false);

      const fetched = yield* todos.getById(OWNER, created.id);
      assert.strictEqual(fetched.title, "write the example slice");

      const completed = yield* todos.update(OWNER, created.id, { completed: true });
      assert.strictEqual(completed.completed, true);

      const listed = yield* todos.list(OWNER);
      assert.deepStrictEqual(
        listed.map((todo) => todo.id),
        [created.id],
      );

      yield* todos.remove(OWNER, created.id);

      const afterRemoval = yield* todos.getById(OWNER, created.id).pipe(Effect.flip);
      assert.strictEqual(afterRemoval.reason._tag, "TodoNotFound");
    }),
  );

  it.effect("hides another user's todo behind TodoNotFound", () =>
    Effect.gen(function* () {
      yield* seedUsers;
      const todos = yield* Todos;

      const created = yield* todos.create(OWNER, { title: "not yours" });

      const read = yield* todos.getById(OTHER, created.id).pipe(Effect.flip);
      assert.strictEqual(read.reason._tag, "TodoNotFound");

      const written = yield* todos
        .update(OTHER, created.id, { title: "hijacked" })
        .pipe(Effect.flip);
      assert.strictEqual(written.reason._tag, "TodoNotFound");

      const deleted = yield* todos.remove(OTHER, created.id).pipe(Effect.flip);
      assert.strictEqual(deleted.reason._tag, "TodoNotFound");

      assert.isEmpty(yield* todos.list(OTHER));
    }),
  );

  it.effect("fails with TodoNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const todos = yield* Todos;
      const error = yield* todos.getById(OWNER, -1 as never).pipe(Effect.flip);
      assert.strictEqual(error.reason._tag, "TodoNotFound");
    }),
  );
});
