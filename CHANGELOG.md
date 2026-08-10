# Changelog

Newest first. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Nothing is published anywhere yet, so entries sit under `Unreleased` until there
is a release to name.

An entry says what changed for someone using or reading the repo. Reasoning goes
in an ADR, not here — link it.

## [Unreleased]

### Added

- **Containers.** A root `Dockerfile` with `server` (195MB) and `web` (104MB)
  targets on `oven/bun:1.3.14-alpine`, and a `compose.yaml` running Postgres 18
  plus both apps. `docker compose up -d` brings up Postgres alone for the host
  dev loop; `docker compose --profile app up -d --build` runs the whole stack
  (ADR 0014). Root `.env.example` documents the compose variables.
- **`apps/server/src/migrate.ts`** applies `drizzle/` with drizzle-orm's
  migrator, so the runtime image carries no drizzle-kit. Compose runs it as a
  one-shot service the server waits on.

- **Route protection tiers in `apps/web`.** Two pathless layout routes gate on the
  session: `_protected` sends a signed-out visitor to `/signin`, `_guest` sends a
  signed-in one to `/todos`, and a route left at the top level stays public. URLs
  are unchanged — `/signin`, `/signup` and `/todos` keep their paths.
- **Nitro build for `apps/web`** (`nitro` 3.0.260610-beta, `nitro/vite` plugin).
  `bun run build` now emits `.output/`, and `bun run start` serves
  `.output/server/index.mjs` — which serves `/assets/*` too, so the production
  build no longer 404s every stylesheet and JS chunk (ADR 0013).
- **Root not-found component.** `__root.tsx` sets `notFoundComponent`, replacing
  TanStack Router's `<p>Not Found</p>` default and its startup warning.
- **Root `bun run start`** runs the production build of both apps
  (`start:web`, `start:server`); `apps/web` gained a `start`.
- **`apps/web/.env`** (from `.env.example`): `PORT` — default 3001, honoured by
  `dev`, `preview` and the production `start` — and `VITE_API_URL`. No port is
  hardcoded in a script any more.
- **Root `db:*` scripts** forward to `apps/server`'s drizzle-kit, which now also
  exposes `db:pull`, `db:check` and `db:up` alongside generate/migrate/push/studio.
- **CI** (`.github/workflows/ci.yml`). One job on pushes to `main` and every PR:
  `typecheck`, `lint`, `format:check`, `test` — the last against a throwaway
  Postgres service container. Lefthook only checks staged files, so nothing
  verified the whole repo before this.
- **Isolated test database.** Server tests read `DATABASE_URL` from
  `apps/server/.env.test` (see `.env.test.example`) instead of `.env`, run the
  real migrations before the suite, and truncate every table before each test —
  `apps/server/src/test-db.ts`. Root `bun run test` runs them. Tests no longer
  delete their own rows (ADR 0004).
- **`README.md`.** Stack, layout, setup, run and check commands, and where the
  rules live for someone arriving at the repo cold.
- **Documentation split.** `AGENTS.md` now carries only rules an agent can
  violate; `docs/technical/architecture.md` describes the system and its known
  ceilings, and `docs/technical/adr/` records the thirteen decisions behind it.
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

- **Sign-in and sign-up cards are centred** in the viewport instead of sitting at
  the top of the page.
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
