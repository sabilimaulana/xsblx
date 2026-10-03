---
status: accepted
version: 1.0.0
updated: 2026-10-03
supersedes:
  - ./0002-effect-drizzle-and-better-auth-move-as-one.md
---

# 0019 — The version set goes stable: effect 4.0.0, better-auth 1.7.5, vitest 5

## Context

The `cloudflare` branch already moved its set to Effect 4 stable (its ADR
0029). This branch follows with the same versions so both branches share one
Effect generation: staying on `4.0.0-beta.103` while the ecosystem stabilizes
leaves the VPS deploy on `effect/unstable/*` paths stable Effect deleted.

## Decision

**One catalog bump moves the whole set.**

- **`catalog:effect` → `4.0.0`**, covering `effect`,
  `@effect/platform-bun`, `@effect/opentelemetry`, `@effect/sql-pg` and
  `@effect/vitest`. `@effect/tsgo` → `0.45.0` in the same change.
- **`vitest` → `^5.0.1`** in `apps/server`: `@effect/vitest@4.0.0` peers
  `vitest >= 5 < 6`, so vitest 4 no longer resolves.
- **`drizzle-orm` → `1.0.0-rc.5-ab785fc`** in `apps/server`, matching the
  cloudflare pin. Drizzle does not move past rc.5 (no newer rc exists).
- **`better-auth` and `@better-auth/drizzle-adapter` → `1.7.5`** in
  `catalog:auth`, matching cloudflare.
- **`repos/effect` is re-vendored to match** — the tag `effect@4.0.0`.
- **The `unstable/*` imports take their stable paths**:
  `effect/unstable/http` → `effect/http`,
  `effect/unstable/httpapi` → `effect/http-api`.
- **`Schema.TaggedErrorClass` → `Schema.TaggedError`** and the lowercase
  `Config` constructors take PascalCase (`Config.Port`,
  `Config.NonEmptyString`, `Config.Redacted`, `Config.LogLevel(...)`
  directly instead of `Config.schema`).
- **`tsconfig.effect.json` aliases `effect/unstable/sql/*` back onto
  `effect/sql/*`.** drizzle-orm rc.5's *types* import the removed unstable
  path; its runtime imports are relative and unaffected. The alias is tied to
  the drizzle pin — drop it when drizzle moves past rc.5.
- **ADR 0002's standing rule survives**: never bump one member of the set
  alone, and bump through the root catalogs rather than in a workspace.

## Consequences

- **`Effect.catchAll` is gone in stable** (and was never the fix for untyped
  third-party effects). Untyped failures get a `Data.Error` subclass via
  `Effect.mapError` at the call site — see `migrate.ts` / `test-db.ts`.
- **Server tests still need live Postgres + SeaweedFS** (`docker compose`);
  the migration itself is verified by typecheck, lint, format, and contract
  tests that do not need infrastructure.
