import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { Db } from "../../db/index.ts";
import { atomically, nowMillis } from "./yielded-support.ts";
import {
  passwordAttemptCharges,
  passwordAttempts,
  passwordCommands,
  sessionFlows,
  sessions,
} from "./yielded-tables.ts";

/**
 * Deletes the auth rows nothing can use any more. The ports only ever read
 * rows inside their window, so without this every table below grows by one
 * row per sign-in, forever. Runs from the API Worker's cron (`worker.ts`).
 *
 * Attempt charges are kept for a day: yielded caps a budget window at 24h, so
 * no budget can still count an older charge.
 *
 * ponytail: each DELETE scans by time with no index on that column alone; fine
 * hourly at today's volume. Index the time columns, or delete in pages, if a
 * run starts approaching D1's statement time limit.
 */
export const cleanupExpired = Effect.fn("AuthCleanup.run")(function* () {
  const db = yield* Db;
  const now = nowMillis();
  yield* atomically(db)([
    db.delete(passwordAttempts).where(sql`retention_until <= ${now}`),
    db.delete(passwordCommands).where(sql`retention_until <= ${now}`),
    db.delete(passwordAttemptCharges).where(sql`occurred_at < ${now - 86_400_000}`),
    db.delete(sessions).where(sql`min(expires_at, absolute_expires_at) <= ${now}`),
    db.delete(sessionFlows).where(sql`dedup_until <= ${now}`),
  ]).pipe(Effect.orDie);
  yield* Effect.logInfo("auth cleanup ran");
});
