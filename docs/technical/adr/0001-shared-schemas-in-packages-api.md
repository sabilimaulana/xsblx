---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0001 — Shared schemas live in `packages/api`

## Context

The server implements an HTTP contract and the web consumes it. If each side
declares its own types, a rename compiles on both sides and fails at runtime, in
the browser, against real data. The alternative — the web importing from
`apps/server` — drags server-only dependencies (drizzle, `@effect/sql-pg`, Better
Auth's server instance) into the browser bundle and couples the client to
persistence.

## Decision

Domain schemas, the `HttpApi` definition and domain errors live in
`packages/api`. The server implements them; the web consumes them through
`HttpApiClient`. `apps/web` never imports from `apps/server`.

`packages/api` exports one subpath per feature file — `@xsblx/api/<feature>/<file>`
via `"./*": "./src/features/*.ts"` — plus `@xsblx/api/api` for the composed root.

## Consequences

- A schema rename is a compile error in both apps in the same change. That is the
  point.
- `packages/api` must stay free of IO and framework types: it is imported by a
  browser bundle.
- Anything genuinely server-only (drizzle tables, the Better Auth instance) stays
  in `apps/server` and is therefore invisible to the web — including auth's HTTP
  contract, see ADR 0007.
