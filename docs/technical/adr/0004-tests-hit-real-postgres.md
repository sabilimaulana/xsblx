---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0004 — Tests hit real Postgres

## Context

Services own SQL (ADR 0003). A hand-written in-memory fake of a repository would
only test itself: it cannot catch a constraint violation, migration drift, a type
mismatch, or an `ON CONFLICT` that does not do what was assumed.

## Decision

Server tests are `@effect/vitest` `layer(...)` integration tests against a real
Postgres. `DATABASE_URL` comes from `apps/server/.env`, loaded in
`vitest.config.ts` — via `process.loadEnvFile`, not vite's `loadEnv`, because
`apps/server` must not depend on vite (ADR 0006).

Tests live beside the code they test, `src/**/*.test.ts`. There is no `test/`
directory.

## Consequences

- Running tests requires a database. A setup cost paid once.
- Tests are slower than unit tests and must clean up after themselves.
- Migrations are exercised by the test run, so schema drift fails loudly.
