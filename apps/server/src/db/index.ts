import type { D1 } from "alchemy/Drizzle/D1";
import { Context, Effect, Layer } from "effect";
import type { relations } from "./relations.ts";

/**
 * Drizzle over the Worker's D1 binding. Queries are Effects failing with
 * `SqlError`, so services `Effect.orDie` them rather than widening a domain
 * error channel (ADR 0003).
 *
 * There is no self-building `Layer` here, and there cannot be: a D1 binding only
 * exists inside a Worker. `worker.ts` opens the client in its init phase and
 * hands it over with `Db.layer(db)`. Services keep depending on this tag and
 * never on the client, which is what keeps them substitutable.
 */
export class Db extends Context.Service<
  Db,
  Effect.Success<ReturnType<typeof D1<typeof relations>>>
>()("server/db/Db") {
  static readonly layer = (db: Db["Service"]): Layer.Layer<Db> => Layer.succeed(Db)(db);
}
