import { PgClient } from "@effect/sql-pg";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Effect, Layer, ManagedRuntime } from "effect";
import { fileURLToPath } from "node:url";
import { Drizzle, PgLive } from "./db/index.ts";

/**
 * `provideMerge` so the raw client stays reachable: cleanup truncates every
 * table by name, which drizzle's typed API cannot express.
 */
const TestDb = Drizzle.layer.pipe(Layer.provideMerge(PgLive));

const runtime = ManagedRuntime.make(TestDb);

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Runs the same migrations as production, so schema drift fails the test run
 * instead of surfacing as a confusing query error (ADR 0004).
 */
export const migrateTestDb = () =>
  runtime.runPromise(Drizzle.use((db) => migrate(db, { migrationsFolder })).pipe(Effect.orDie));

/**
 * Truncating before each test is what keeps assertions like "this user sees no
 * todos" honest: a test that fails midway leaves rows behind, and the next run
 * would inherit them forever.
 */
export const resetTestDb = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const tables = yield* sql<{ tablename: string }>`
        select tablename from pg_tables
        where schemaname = 'public' and tablename not like '\\_\\_drizzle%'
      `;
      if (tables.length === 0) return;
      const list = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
      yield* sql.unsafe(`truncate table ${list} cascade`);
    }).pipe(Effect.orDie),
  );

export const disposeTestDb = () => runtime.dispose();
