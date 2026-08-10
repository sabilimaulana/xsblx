/**
 * Barrel over every feature's tables. drizzle-kit takes a single schema entry and
 * `defineRelations` needs all tables at once, so the tables themselves live in
 * `features/<name>/schema.ts` and are re-exported here.
 */
export * from "../features/auth/schema.ts";
export * from "../features/todos/schema.ts";
