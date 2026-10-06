import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { storage } from "./yielded-storage.ts";

/**
 * yielded managed tables as static exports.
 *
 * `storage.schema` builds the tables at import time (pure table construction,
 * no I/O), but alchemy's `Drizzle.Schema` diffs the schema file's top-level
 * exports — a nested object is invisible to it. Destructured re-exports keep
 * one definition while staying discoverable. The `xsblx_auth_` prefix comes
 * from the `managed()` call in `yielded-storage.ts`.
 */
export const {
  identifiers,
  credentials,
  sessions,
  sessionFlows,
  passwords,
  passwordAttempts,
  passwordCommands,
  passwordRegistrations,
  proofRequests,
  proofSeries,
  proofGenerations,
  proofContinuations,
  proofScopes,
  proofAbuse,
  proofFailures,
  proofCommands,
} = storage.schema;

/**
 * Password attempt charges for the D1 `PasswordAttemptLimiter`.
 *
 * yielded moved attempt limiting out of persistence into that service, and
 * its default is a per-isolate memory bucket — on Workers every isolate would
 * count on its own. This table is the shared budget: one row per consumed
 * attempt, counted over a rolling window, expired rows pruned per key.
 */
export const passwordAttemptCharges = sqliteTable(
  "xsblx_auth_password_attempt_charges",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id").notNull(),
    action: text("action").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [
    index("xsblx_auth_password_attempt_charges_key_idx").on(
      table.moduleId,
      table.action,
      table.scope,
      table.key,
      table.occurredAt,
    ),
  ],
);
