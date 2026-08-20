# xsblx

A Bun monorepo running an Effect backend and a TanStack Start frontend against
Postgres, with the API contract shared between them as Effect `Schema`.

## Stack

| Layer    | Choice                                                            |
| -------- | ----------------------------------------------------------------- |
| Runtime  | Bun workspaces                                                    |
| Backend  | Effect `4.0.0-beta.103`, `@effect/platform-bun`, `@effect/sql-pg` |
| Database | Postgres via `drizzle-orm` + `drizzle-kit`                        |
| Auth     | Better Auth (runs outside the Effect runtime — ADR 0007)          |
| Frontend | TanStack Start / Router / Query / Form, React 19                  |
| UI       | shadcn components in `packages/ui`, Tailwind 4                    |
| Contract | `packages/api` — `HttpApi` definition, schemas, domain errors     |

## Layout

```
apps/server     Effect HTTP server, drizzle schema + migrations
apps/web        TanStack Start app (the only workspace that may depend on vite)
packages/api    Shared HttpApi definition, schemas, domain errors
packages/ui     shadcn component library
docs/           Architecture, ADRs, PRDs — start at docs/README.md
repos/          Vendored reference sources (gitignored, never imported)
scripts/        vendor.sh — fetches repos/ at pinned tags
```

Code is feature-first: one feature is one directory per package, and the layer
is the filename (ADR 0005). `features/todos/` is the reference slice.

## Setup

```sh
bun install
./scripts/vendor.sh                  # optional: reference sources into repos/
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Fill in `apps/server/.env` — it needs a `DATABASE_URL` pointing at a Postgres
you can reach, an `AUTH_SECRET`, and the `S3_*` values of the object store that
holds avatars (ADR 0018). `docker compose up -d` starts both Postgres and
SeaweedFS; the S3 credentials in the root `.env` are the ones SeaweedFS is
configured with, so the two files must agree. Then create the schema:

```sh
bun run --filter server db:migrate
```

To run the tests, also fill in `apps/server/.env.test` from
`apps/server/.env.test.example`. It must point at a **separate** database: the
test run truncates every table before each test (ADR 0004). The tests migrate it
themselves.

## Running

```sh
bun run dev          # both apps
bun run dev:web      # web only, port 3001
bun run dev:server   # server only, port 3000

bun run build        # production build of web → apps/web/dist
bun run start        # run that build plus the server
bun run start:web
bun run start:server
```

## Docker

One `Dockerfile` (targets `server` and `web`) and one `compose.yaml`, split by
profile (ADR 0014). Copy `.env.example` to `.env` first and set `AUTH_SECRET`.

```sh
docker compose up -d                        # Postgres only — `bun dev` on the host
docker compose --profile app up -d --build  # the whole stack: db, server, web
docker compose --profile app down -v        # and throw the data away
```

The `app` profile runs migrations as a one-shot `migrate` service before the
server starts. `VITE_API_URL` is compiled into the client bundle, so changing
the API origin means rebuilding the `web` image, not restarting it.

Ports come from `PORT` in each app's `.env` (`apps/web` 3001, `apps/server` 3000) and apply to `dev` and `start` alike — change the env, not a script. The
database commands are `bun run db:generate | db:migrate | db:push | db:pull |
db:check | db:up | db:studio`.

The web app expects the server at the origin listed in `CORS_ALLOWED_ORIGINS`;
CORS must keep `credentials: true` for the session cookie to survive (ADR 0008).

## Checks

```sh
bun run typecheck    # tsc + Effect diagnostics — treat TS377001 etc. as errors
bun run lint
bun run format:check
bun run test         # server tests, against a real Postgres (ADR 0004)
```

These four are exactly what CI runs (`.github/workflows/ci.yml`) on every push to
`main` and every PR, with Postgres as a service container. Lefthook runs format
and lint on staged files at commit time; CI is what covers the whole repo.

## Contributing

`AGENTS.md` (symlinked as `CLAUDE.md`) holds the rules that apply to every edit.
Read it before changing code. Decisions that are expensive to reverse get an ADR
in `docs/technical/adr/`; anything shipped or removed gets a `CHANGELOG.md`
entry in the same commit.
