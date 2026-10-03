---
status: accepted
version: 1.0.0
updated: 2026-10-03
supersedes:
  - ./0028-the-version-set-takes-beta-78-and-vitest-5.md
---

# 0029 — The version set goes stable: effect 4.0.0 and alchemy beta.80

## Context

Alchemy `2.0.0-beta.80` imports stable `effect/cli/*`, which no release
candidate exports — rc.115 only has `effect/unstable/cli`. The CLI cannot even
start against the rc set, so beta.80 forces the whole set onto stable Effect.

Beta.79 was evaluated as a smaller step first and rejected: it declares the
missing `mime` dependency beta.78 lacked, but its wider graph resolves two
`drizzle-orm` instances (plus `rc.115` twins of `@effect/sql-d1` and
`@effect/sql-sqlite-do` next to stable ones) and typecheck fails on the split.
Pinning the twins down with root `overrides` restores green, but overrides are
a second version truth next to the catalogs — exactly what ADR 0027 banned.
The coherent move is the full set to stable, where the graph unifies with no
overrides.

Drizzle does not move again: beta.80 still pins `drizzle-orm` and
`drizzle-kit` at exactly `1.0.0-rc.5-ab785fc`.

## Decision

**One catalog bump moves the whole set, and `scripts/vendor.sh` moves with it.**

- **`catalog:effect` → `4.0.0`**, covering `effect`,
  `@effect/platform-bun`, `@effect/platform-node`, `@effect/sql-d1` and
  `@effect/vitest`. `@effect/tsgo` stays at `0.45.0`; its Effect diagnostics
  still fire against stable.
- **`drizzle-orm` and `drizzle-kit` stay at `1.0.0-rc.5-ab785fc`** — still the
  exact build alchemy peers on.
- **`alchemy` and `@alchemy.run/better-auth` → `2.0.0-beta.80`** in
  `catalog:alchemy`.
- **`repos/effect` and `repos/alchemy` are re-vendored to match** — the tag
  `effect@4.0.0` and the tag `v2.0.0-beta.80`.
- **No `overrides` in the root `package.json`.** The stable graph resolves one
  copy of each set member; if a future bump splits again, move the set, do not
  pin around it.
- **The `unstable/*` imports take their stable paths**: `effect/unstable/http`
  → `effect/http`, `effect/unstable/httpapi` → `effect/http-api` (twelve
  files, mechanical rename, every symbol verified present).
- **ADR 0027's standing rule survives its third supersession**: never bump one
  member of the set alone, and bump through the root catalogs rather than in a
  workspace. Only the versions changed.

## Consequences

- **The `unstable` paths are gone.** Stable Effect does not export them, so
  any reintroduction fails typecheck immediately rather than rotting.
- **`better-auth@1.7.5`, its drizzle adapter, `effect-query` and
  `effect-machine` all run on stable Effect.** Verified by the full suite
  (typecheck across five projects, lint, format, contract tests, `alchemy
  plan`), not by reading peer ranges.
- **`VITE_API_URL` is overridable from the environment** (read through
  `Config`, since raw `process.env` reads are rejected in Effect code). This
  is what lets dev serve the Website against a public tunnel hostname; without
  the variable the build still inlines the API Worker's own URL.
