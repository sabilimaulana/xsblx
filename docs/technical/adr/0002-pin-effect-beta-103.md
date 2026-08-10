---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0002 — Effect pinned to 4.0.0-beta.103

## Context

Every published `drizzle-orm@1.0.0-rc.*` build calls `Schema.TaggedErrorClass`,
which exists only in effect beta.97–103. beta.104 removed it, so importing
`drizzle-orm/effect-postgres` on beta.104+ throws
`Schema.TaggedErrorClass is not a function` at import time — before any
application code runs.

beta.103 is the highest version where both libraries work, and `@effect/sql-pg`,
`@effect/platform-bun` and `@effect/vitest` all publish at it.

`effect-query`'s peer range asks for beta.104, but it imports only `Cause`,
`Effect`, `Exit`, `Option` and `ManagedRuntime`, all present in beta.103.

## Decision

Pin `effect` and its companions to `4.0.0-beta.103` through the root
`catalog:effect`. Never bump one of them alone. `repos/effect` is vendored at tag
`effect@4.0.0-beta.103` so the reference source matches the runtime.

## Consequences

- Code follows the beta.103 API, not the latest docs:
  `Schema.TaggedErrorClass<Self>()(tag, fields, annotations)`, **not**
  `Schema.TaggedError`.
- Drizzle queries are Effects failing with `SqlError`. `Effect.orDie` them in
  services rather than widening domain error channels (ADR 0003).
- `effect-query@1.0.0` is installed against a mismatched peer range on purpose;
  npm has no 1.0.4 despite the vendored tag, and 1.0.0 exports the same API.
- Unpinning is one change that bumps `effect`, `@effect/sql-pg`,
  `@effect/platform-bun`, `@effect/vitest`, `@effect/tsgo` and re-vendors
  `repos/effect` together.
- Revisit only when drizzle publishes a build against beta.104+.
