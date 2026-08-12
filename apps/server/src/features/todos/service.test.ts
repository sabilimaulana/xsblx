import { assert, layer } from "@effect/vitest";
import type { TodoCursor, TodoPage } from "@xsblx/api/todos/schema";
import { TodoId } from "@xsblx/api/todos/schema";
import { Effect, Layer, Metric } from "effect";
import { Drizzle, DrizzleLive } from "../../db/index.ts";
import { user } from "../auth/schema.ts";
import type { TodoListOptions } from "./service.ts";
import { Todos, todosCreated } from "./service.ts";

const OWNER = "test-user-owner";
const OTHER = "test-user-other";

/** What the query schema's defaults decode to, for tests that do not page. */
const ALL: TodoListOptions = { status: "all", limit: 20 };

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

      const listed = yield* todos.list(OWNER, ALL);
      assert.deepStrictEqual(
        listed.items.map((todo) => todo.id),
        [created.id],
      );
      assert.strictEqual(listed.nextCursor, null);

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

      assert.isEmpty((yield* todos.list(OTHER, ALL)).items);
    }),
  );

  /**
   * The property that matters is that following the cursor walks the same list
   * the unpaged query returns, once each. Asserting against creation order would
   * be wrong: a nanoid carries no ordering, so rows sharing a millisecond are
   * ordered by id — deterministic, but not the order they were inserted in.
   *
   * These five inserts land in the same millisecond often enough that this is
   * also the regression test for the tie-break half of the cursor.
   */
  it.effect("pages the whole list once by following nextCursor", () =>
    Effect.gen(function* () {
      yield* seedUsers;
      const todos = yield* Todos;

      yield* Effect.forEach([1, 2, 3, 4, 5], (n) => todos.create(OWNER, { title: `todo ${n}` }), {
        concurrency: 1,
      });

      const unpaged = (yield* todos.list(OWNER, ALL)).items.map((todo) => todo.id);
      assert.strictEqual(unpaged.length, 5);

      const paged: Array<TodoId> = [];
      let cursor: TodoCursor | undefined = undefined;
      let pages = 0;
      do {
        const page: TodoPage = yield* todos.list(OWNER, { status: "all", limit: 2, cursor });
        paged.push(...page.items.map((todo) => todo.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor !== undefined);

      assert.deepStrictEqual(paged, unpaged);
      // 2 + 2 + 1: the final page is short of `limit`, so it carries no cursor.
      assert.strictEqual(pages, 3);
    }),
  );

  it.effect("filters by status", () =>
    Effect.gen(function* () {
      yield* seedUsers;
      const todos = yield* Todos;

      const open = yield* todos.create(OWNER, { title: "open" });
      const done = yield* todos.create(OWNER, { title: "done" });
      yield* todos.update(OWNER, done.id, { completed: true });

      const onlyOpen = yield* todos.list(OWNER, { status: "open", limit: 20 });
      assert.deepStrictEqual(
        onlyOpen.items.map((todo) => todo.id),
        [open.id],
      );

      const onlyDone = yield* todos.list(OWNER, { status: "done", limit: 20 });
      assert.deepStrictEqual(
        onlyDone.items.map((todo) => todo.id),
        [done.id],
      );
    }),
  );

  /**
   * The counter is read in-process rather than through an exporter: the metric
   * registry is global and survives the truncate between tests, so the assertion
   * is on the delta, never the absolute count.
   */
  it.effect("counts successful creations", () =>
    Effect.gen(function* () {
      yield* seedUsers;
      const todos = yield* Todos;

      const before = yield* Metric.value(todosCreated);
      yield* todos.create(OWNER, { title: "counted" });
      const after = yield* Metric.value(todosCreated);

      assert.strictEqual(after.count, before.count + 1);
    }),
  );

  it.effect("does not count a failed creation", () =>
    Effect.gen(function* () {
      const todos = yield* Todos;

      const before = yield* Metric.value(todosCreated);
      // No seeded users, so the owner foreign key rejects the insert. The
      // service dies rather than failing, hence `Effect.exit` on the defect.
      yield* todos.create("nobody", { title: "orphan" }).pipe(Effect.exit);
      const after = yield* Metric.value(todosCreated);

      assert.strictEqual(after.count, before.count);
    }),
  );

  it.effect("fails with TodoNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const todos = yield* Todos;
      const error = yield* todos
        .getById(OWNER, TodoId.make("V1StGXR8Z5jdHi6BmyTaP"))
        .pipe(Effect.flip);
      assert.strictEqual(error.reason._tag, "TodoNotFound");
    }),
  );
});
