# xsblx

A Bun monorepo running an Effect backend and a TanStack Start frontend against
Postgres, with the API contract shared between them as Effect `Schema`.

## Stack

| Layer     | Choice                                                             |
| --------- | ------------------------------------------------------------------ |
| Runtime   | Bun workspaces                                                     |
| Backend   | Effect `4.0.0-beta.103`, `@effect/platform-bun`, `@effect/sql-pg`   |
| Database  | Postgres via `drizzle-orm` + `drizzle-kit`                         |
| Auth      | Better Auth (runs outside the Effect runtime — ADR 0007)           |
| Frontend  | TanStack Start / Router / Query / Form, React 19                   |
| UI        | shadcn components in `packages/ui`, Tailwind 4                     |
| Contract  | `packages/api` — `HttpApi` definition, schemas, domain errors       |

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
```

Fill in `apps/server/.env` — it needs a `DATABASE_URL` pointing at a Postgres
you can reach, an `AUTH_SECRET`, and S3 credentials. Then create the schema:

```sh
bun run --filter server db:migrate
```

## Running

```sh
bun run dev          # both apps
bun run dev:web      # web only, port 3001
bun run dev:server   # server only, port 3000
```

The web app expects the server at the origin listed in `CORS_ALLOWED_ORIGINS`;
CORS must keep `credentials: true` for the session cookie to survive (ADR 0008).

## Checks

```sh
bun run typecheck    # tsc + Effect diagnostics — treat TS377001 etc. as errors
bun run lint
bun run format:check
bun run --filter server test   # hits a real Postgres (ADR 0004)
```

## Contributing

`AGENTS.md` (symlinked as `CLAUDE.md`) holds the rules that apply to every edit.
Read it before changing code. Decisions that are expensive to reverse get an ADR
in `docs/technical/adr/`; anything shipped or removed gets a `CHANGELOG.md`
entry in the same commit.
