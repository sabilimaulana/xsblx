---
status: accepted
version: 1.0.0
updated: 2026-08-20
---

# 0020 — D1 is the database, and integration tests move to a deployed stage

## Context

A Worker cannot open a TCP connection to Postgres from an isolate, so moving to
Cloudflare (ADR 0019) forces a choice about where rows live:

- **Hyperdrive in front of Postgres.** Keeps `pgTable`, `@effect/sql-pg` and
  every SQL idiom already written, including the row-value keyset seek (ADR
  0016). Costs a managed Postgres (Neon, PlanetScale, or the VPS's own) plus a
  Hyperdrive config, and every query pays a pooled round-trip out of the edge.
- **D1.** Cloudflare's own SQLite, reached through a native binding: nothing to
  provision, no connection string, no pooler, and read replication available per
  database. Costs a dialect change — `pgTable` → `sqliteTable`, `@effect/sql-pg`
  → `@effect/sql-d1` — and SQLite's limits become ours.

The domain code is drizzle's query builder end to end, and no query in the repo
uses a Postgres-only feature: no `jsonb`, no arrays, no `RETURNING` we could not
have, no advisory locks, no extensions.

## Decision

**D1 is the database, and the schema is `drizzle-orm/sqlite-core`.**

- **Queries stay Effects.** `alchemy/Drizzle/D1` builds an `@effect/sql-d1`
  client over the binding and drives `drizzle-orm/effect-d1` with it, so a query
  is still an Effect failing with `SqlError` and services still `Effect.orDie`
  them (ADR 0003). The client is created lazily on the first query of an event
  and torn down when the event settles — nothing connects at init.
- **The `Db` service replaces the self-building `Drizzle` layer.** A binding only
  exists inside a Worker, so `worker.ts` opens the client in its init phase and
  provides it with `Db.layer(db)`. Services depend on the tag, never the client.
- **Migrations are generated and applied by the deploy.** `Drizzle.Schema` diffs
  `db/schema.ts` and writes pending SQL into `apps/server/drizzle/`; that
  directory is the D1 database's `migrationsDir`, which is the dependency edge
  that orders generate-then-apply inside one `alchemy deploy`. `migrate.ts`,
  `drizzle.config.ts`, the `db:*` scripts and the committed Postgres migrations
  are all gone.
- **Columns map to SQLite's two useful types.** A boolean is
  `integer({ mode: "boolean" })`; an instant is
  `integer({ mode: "timestamp_ms" })`, which drizzle presents as a `Date` on both
  sides. `todos.createdAt` defaults to
  `CAST(unixepoch('subsec') * 1000 AS INTEGER)` — the database's clock, in the
  unit the column stores.
- **This supersedes ADR 0004.** A D1 binding exists only inside a Worker, so
  there is no off-platform database for a service test to point at and no
  `.env.test` to give it. The integration test becomes an end-to-end test:
  `*.e2e.test.ts` deploys the stack to a stage with alchemy's `Test` harness,
  drives the real API over HTTP with the same typed client the web app uses, and
  destroys it. It needs credentials, so it runs under `bun run test:e2e` and not
  under `bun run test`.

## Consequences

- **Keyset pagination is unchanged and still an index seek.** SQLite has
  supported row values since 3.15, so `(createdAt, id) < (?, ?)` is still one
  predicate over `todos_userId_createdAt_id_idx` — the `a < x OR (a = x AND b <
y)` expansion, and its off-by-one on the page boundary, stays avoided (ADR
  0016). The cursor's `createdAt` half is parsed to epoch milliseconds before it
  is bound, because the column is an integer.
- **The millisecond ceiling became a property of the column.** `timestamp_ms`
  _is_ the cursor's precision, so a stored value can no longer sort after its own
  truncated cursor. Widening the column is the only way back to that bug.
- **`bun run test` no longer touches a database.** What is left off-platform is
  the contract test (`http.test.ts`): it decodes the endpoint's built query
  schema and asserts defaults, bounds and string parsing. CI needs no service
  container.
- **There are no interactive transactions.** D1 executes one statement, or a
  batch, per round-trip; there is no `BEGIN` a Worker can hold open across
  awaits. Nothing in the repo needs one today, and the first thing that does gets
  a `batch` or a different design — not a retry loop.
- **SQLite's limits are now the ceilings.** A D1 database is capped in size (10
  GB at the time of writing) and a single-writer engine, so write throughput is
  serialised per database. Read replication is a per-database setting, not a code
  change. These belong in `architecture.md` and are the numbers to revisit before
  the first million rows, not after.
- **Foreign keys are declared and enforced.** `todos.user_id` still references
  `user.id` with `ON DELETE CASCADE`, and keeping the auth tables in this same
  database is what makes that possible (ADR 0022).
- **The generated migration directory is committed, but starts empty.** The first
  `alchemy deploy` writes the initial migration; the Postgres history was deleted
  rather than translated, because a SQLite database has never seen it.
