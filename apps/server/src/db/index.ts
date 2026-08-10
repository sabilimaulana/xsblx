import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";
import { DatabaseConfig } from "../config.ts";
import { relations } from "./relations.ts";

/**
 * Drizzle running on Effect's own Postgres client, so queries are Effects with
 * tracing spans and Effect-native transactions.
 */
export class Drizzle extends Context.Service<
  Drizzle,
  Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults<typeof relations>>>
>()("server/db/Drizzle") {
  static readonly layer = Layer.effect(Drizzle, PgDrizzle.makeWithDefaults({ relations }));
}

export const PgLive = PgClient.layerConfig(DatabaseConfig);

export const DrizzleLive = Drizzle.layer.pipe(Layer.provide(PgLive));
