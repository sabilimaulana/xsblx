import { storage } from "./yielded-storage.ts";

/**
 * Spike: yielded managed tables as static exports.
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
  passwordScopes,
  passwordCharges,
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
