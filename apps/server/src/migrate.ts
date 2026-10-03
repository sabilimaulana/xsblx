import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Data, Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { fileURLToPath } from "node:url";
import { Drizzle, DrizzleLive } from "./db/index.ts";

/**
 * Applies `drizzle/` to the configured database and exits. Uses drizzle-orm's
 * migrator rather than `drizzle-kit migrate` so the production image carries no
 * dev dependencies.
 */
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

class MigrateError extends Data.Error<{
  readonly cause: unknown;
}> {
  readonly _tag = "MigrateError";
}

Drizzle.use((db) =>
  Effect.mapError(
    migrate(db, { migrationsFolder }),
    (cause: unknown) => new MigrateError({ cause }),
  ),
).pipe(Effect.provide(DrizzleLive), Effect.orDie, BunRuntime.runMain);
