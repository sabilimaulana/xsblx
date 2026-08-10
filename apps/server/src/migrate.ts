import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { fileURLToPath } from "node:url";
import { Drizzle, DrizzleLive } from "./db/index.ts";

/**
 * Applies `drizzle/` to the configured database and exits. Uses drizzle-orm's
 * migrator rather than `drizzle-kit migrate` so the production image carries no
 * dev dependencies.
 */
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

Drizzle.use((db) => migrate(db, { migrationsFolder })).pipe(
  Effect.provide(DrizzleLive),
  Effect.orDie,
  BunRuntime.runMain,
);
