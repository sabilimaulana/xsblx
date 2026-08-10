---
status: accepted
version: 1.1.0
updated: 2026-08-10
---

# 0004 — Tests hit real Postgres

## Context

Services own SQL (ADR 0003). A hand-written in-memory fake of a repository would
only test itself: it cannot catch a constraint violation, migration drift, a type
mismatch, or an `ON CONFLICT` that does not do what was assumed.

## Decision

Server tests are `@effect/vitest` `layer(...)` integration tests against a real
Postgres.

**A dedicated database, never the development one.** `DATABASE_URL` comes from
`apps/server/.env.test` — `apps/server/.env` is deliberately not loaded, because
the test run truncates every table in the `public` schema. `vitest.config.ts`
reads it with `process.loadEnvFile`, not vite's `loadEnv`, because `apps/server`
must not depend on vite (ADR 0006). A missing `.env.test` fails the run.

**The suite owns cleanup, tests do not.** `apps/server/src/test-db.ts` runs the
real migrations once and truncates every table before each test, wired in through
`setupFiles`. A test never deletes its own rows: hand-rolled teardown is skipped
when the test fails midway, and the leftovers then break every later run of an
assertion like "this user sees no todos".

Tests live beside the code they test, `src/**/*.test.ts`. There is no `test/`
directory.

## Consequences

- Running tests requires a database and a `.env.test` pointing at it. Copy
  `apps/server/.env.test.example`.
- Every test starts from an empty database, so it seeds what it needs.
- Migrations are exercised by the test run, so schema drift fails loudly.
- One shared test database means `fileParallelism: false`. The ceiling is a suite
  large enough for serial files to hurt; the upgrade is a schema per vitest
  worker, noted at the `ponytail:` comment in `src/test-setup.ts`.
