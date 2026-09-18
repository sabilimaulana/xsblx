---
status: accepted
version: 1.0.0
updated: 2026-09-18
supersedes:
  - ./0027-the-rc-version-set-moves-in-lockstep.md
---

# 0028 — The version set moves to alchemy beta.78, effect rc.115 and vitest 5

## Context

Alchemy released `2.0.0-beta.78` on 2026-09-17
([release notes](https://alchemy.run/blog/2026-09-17-beta-78/)). It requires
`effect >= 4.0.0-rc.115`, so the rc.112 pin from ADR 0027 no longer installs
against it. The set drags a major with it this time: `@effect/vitest` at
`rc.115` peers `vitest >= 5.0.0 < 6.0.0` (at rc.112 it peered
`>= 4.1.0 < 5.0.0`), so staying on vitest 4 is not an option once effect moves.

Drizzle does not move: beta.78 still pins `drizzle-orm` and `drizzle-kit` at
exactly `1.0.0-rc.5-ab785fc`, the same sha ADR 0027 recorded.

Two behavior changes in the crossed range land on this repo directly:

- **Effect rc.113 renamed the `Config` constructors to PascalCase**
  (`Config.string` → `Config.String`, `Config.redacted` → `Config.Redacted`,
  `Config.literals` → `Config.Literals`, and so on) and `Config.mapOrFail` to
  `Config.mapEffect`. Combinators (`map`, `all`, `option`, `withDefault`,
  `orElse`) keep their names. Three call sites use the old names.
- **Alchemy beta.78 defaults `Test.make` to a `test_$USER` stage**, so the e2e
  harness no longer deploys to a bare `test` stage.

Effect rc.113 also replaced `@effect/sql-pg`'s `pg` dependency with a native
wire client, which broke hosted Postgres TLS until rc.115 fixed the SNI half
upstream. Nothing here uses Postgres — the database is D1 (ADR 0020) — so the
whole episode passes through without touching a line.

## Decision

**One catalog bump moves the whole set, and `scripts/vendor.sh` moves with it.**

- **`catalog:effect` → `4.0.0-rc.115`**, covering `effect`,
  `@effect/sql-d1`, `@effect/platform-bun`, `@effect/platform-node` and
  `@effect/vitest`. `@effect/tsgo` → `0.45.0` in the same change; it is not in
  a catalog but it is in the set.
- **`vitest` → `^5.0.1`** in `apps/server`, the only workspace that depends on
  it. The range is forced by `@effect/vitest`'s peer, not chosen.
- **`drizzle-orm` and `drizzle-kit` stay at `1.0.0-rc.5-ab785fc`** — still the
  exact build alchemy peers on.
- **`alchemy` and `@alchemy.run/better-auth` → `2.0.0-beta.78`** in
  `catalog:alchemy`, back on plain semver as ADR 0027's exit prescribed.
- **`repos/effect` and `repos/alchemy` are re-vendored to match** — the tag
  `effect@4.0.0-rc.115` and the tag `v2.0.0-beta.78`.
- **The three `Config` call sites take the PascalCase names**, and the e2e
  comment names the `test_$USER` stage.
- **ADR 0027's standing rule survives its second supersession**: never bump one
  member of the set alone, and bump through the root catalogs rather than in a
  workspace. Only the versions changed.

## Consequences

- **Vitest 4 is uninstallable in this repo now.** `@effect/vitest@rc.115`
  peers `vitest >= 5 < 6`, so any workspace still asking for `^4` fails to
  resolve. There is exactly one such workspace, which bounds the blast radius
  of the next vitest major the same way.
- **`Config`'s lowercase constructors are gone at the type level**, not just
  deprecated — `Config.redacted` is a type error under rc.115, and
  `@effect/tsgo`'s `outdatedApi` diagnostic flags it before `tsc` does.
- **Two rc dependencies still gate each other.** An effect rc.116 that
  beta.78's manifest has not been built against is not installable, and the
  same is true in reverse. Unchanged from ADR 0027, restated because the next
  bump will trip over it again.
