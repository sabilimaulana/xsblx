# Changelog

Newest first. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Nothing is published anywhere yet, so entries sit under `Unreleased` until there
is a release to name.

An entry says what changed for someone using or reading the repo. Reasoning goes
in an ADR, not here — link it.

## [Unreleased]

### Added

- **`README.md`.** Stack, layout, setup, run and check commands, and where the
  rules live for someone arriving at the repo cold.
- **Documentation split.** `AGENTS.md` now carries only rules an agent can
  violate; `docs/technical/architecture.md` describes the system and its known
  ceilings, and `docs/technical/adr/` records the twelve decisions behind it.
  Precedence and versioning conventions are in `docs/README.md`.
- **Email + password auth** (Better Auth 1.7.0-rc.4): `/signin`, `/signup`, a
  session cookie, and `TodosApiGroup` closed behind `Authentication` middleware.
  Handlers take the owner id from `CurrentUser`; another user's row surfaces as
  `TodoNotFound`, never a 403 (ADR 0007).
- **Todos are scoped to the authenticated user.** Every query filters by
  `userId`.
- **`todos` reference slice**, DB → HTTP → UI, with an `@effect/vitest`
  integration test against real Postgres (ADR 0004).

### Changed

- **Server and API folded into feature-first directories** (ADR 0005): one
  feature is one directory per package, and the layer is the filename. Adding a
  feature adds a directory plus two import lines; deleting one is `rm -rf`.
- **Web reads moved onto TanStack Query** via the `effect-query` bridge (ADR
  0010). Route loaders no longer carry server data, so no `Schema.Class` crosses
  the serialization boundary.
- **`tsconfig.effect.json` is shared across workspaces.** Severities are edited
  once at the root; an app that restates the `plugins` array silently drops every
  shared rule.
- Auth tables merged into `apps/server/src/features/auth/schema.ts`, with
  relations in `db/relations.ts` via `defineRelations`.

### Fixed

- **Every route 404'd with `Cannot GET /`.** Two workspaces depended on `vite`,
  so `@tanstack/start-plugin-core` resolved a different copy than the dev server
  and its `instanceof` check failed — the SSR middleware was never installed, with
  no error and no warning. Only `apps/web` may depend on `vite` now (ADR 0006).
