import * as Cloudflare from "alchemy/Cloudflare";
// Imported by subpath: `alchemy/Drizzle` is a barrel that eagerly pulls its
// MySQL and Postgres drivers, whose optional peers are not installed here.
import { Schema as DrizzleSchema } from "alchemy/Drizzle/Schema";
import { Effect } from "effect";

/**
 * The one D1 database, and the migrations that shape it (ADR 0020).
 *
 * `Drizzle.Schema` diffs `db/schema.ts` on every deploy and writes pending SQL
 * into `drizzle/`; handing the schema resource itself to the database's
 * `migrations` prop is the dependency edge that orders generate-then-apply
 * within a single `alchemy deploy`. That is why there is no `migrate.ts` and no
 * `drizzle-kit` invocation of our own.
 *
 * Bookkeeping is alchemy's `__alchemy_migrations` and is not configurable. A
 * database already carrying the `drizzle_migrations` ledger this stack used
 * before is adopted by a one-way conversion on the first deploy: the applied
 * history is copied across and the old table is frozen, never written and never
 * dropped.
 *
 * The paths are plain strings, relative to the workspace root, and that is not a
 * shortcut: this module is `yield*`ed in the Worker's init phase, which runs at
 * runtime as well as at plan time. `fileURLToPath(new URL(…, import.meta.url))`
 * here throws `TypeError: Invalid URL string` inside workerd — before routing, on
 * every request — because a bundled module's `import.meta.url` is not a file URL.
 * A string is inert at runtime, and only the provider resolves it, under Bun, at
 * deploy time (`path.resolve(process.cwd(), …)`). `alchemy` always runs from the
 * root, which is what makes the root-relative form correct.
 */
export const Database = Effect.gen(function* () {
  const schema = yield* DrizzleSchema("Schema", {
    schema: "./apps/server/src/db/schema.ts",
    out: "./apps/server/drizzle",
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("Database", { migrations: schema });
});
