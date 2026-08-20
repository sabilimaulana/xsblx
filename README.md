# xsblx — Cloudflare

A Bun monorepo running an Effect backend and a TanStack Start frontend on
Cloudflare Workers, with the API contract shared between them as Effect `Schema`.
The whole deploy is one alchemy program (ADR 0019).

> **Branches.** `main` is the VPS deploy — Docker, compose, Postgres, SeaweedFS,
> Nitro. This branch (`cloudflare`) is the same system on Workers, D1 and R2.
> They diverge on purpose and are not meant to merge.

## Stack

| Layer     | Choice                                                                |
| --------- | --------------------------------------------------------------------- |
| Runtime   | Bun workspaces; Cloudflare Workers in production                      |
| Infra     | `alchemy` `2.0.0-beta.70` — infrastructure as an Effect program       |
| Backend   | Effect `4.0.0-beta.103`, `HttpApi`, `@effect/sql-d1` over a binding   |
| Database  | Cloudflare D1 via `drizzle-orm/sqlite-core` (ADR 0020)                |
| Storage   | Cloudflare R2, one bucket, `public/*` served by the Worker (ADR 0021) |
| Auth      | Better Auth as a service on the same D1 (ADR 0007, ADR 0022)          |
| Telemetry | Axiom — datasets, ingest token and exporter as resources (ADR 0023)   |
| Frontend  | TanStack Start / Router / Query / Form, React 19                      |
| UI        | shadcn components in `packages/ui`, Tailwind 4                        |
| Contract  | `packages/api` — `HttpApi` definition, schemas, domain errors         |

## Layout

```
alchemy.run.ts  The stack: D1, R2, Axiom datasets, the API Worker, the website
apps/server     The API Worker — HttpApi handlers, drizzle schema, auth
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
./scripts/vendor.sh                  # reference sources into repos/ (effect, alchemy, …)
cp .env.example .env                 # set AUTH_SECRET
bun alchemy login                    # Cloudflare, then Axiom — stored in ~/.alchemy
```

`alchemy login` walks one step per provider in the stack: Cloudflare (OAuth or an
API token) and Axiom (`AXIOM_TOKEN` from the environment, or a token entered
interactively). Neither credential belongs in `.env`.

`.env` is read by `alchemy`, not by an app: a `Config` value a Worker resolves in
its init phase is bound onto the deployed Worker as a secret, so `AUTH_SECRET`
and `CORS_ALLOWED_ORIGINS` live in one file for dev and deploys alike. Cloudflare
credentials are not in it.

There is nothing to start locally and no migration to run by hand — D1 and R2 are
created by the first deploy, and `Drizzle.Schema` generates the migration that
`alchemy deploy` applies (ADR 0020).

## Running

```sh
bun run dev          # alchemy dev: Vite + HMR on :3001, bindings on real resources
bun run plan         # diff the stack against recorded state
bun run deploy       # generate migrations, apply them, upload both Workers
bun run destroy      # remove the stage
bun run tail         # stream Worker logs
```

`alchemy dev` binds the **real** D1 database and R2 bucket, so there is no
emulator to disagree with production — and no offline path. Stages keep that
honest: `--stage <name>` gets its own database, bucket and Workers, and the
default is `dev_$USER`.

## Checks

```sh
bun run typecheck    # tsc + Effect diagnostics — treat TS377001 etc. as errors
bun run lint
bun run format:check
bun run test         # vitest: contract tests, no database
bun run test:e2e     # deploys the stack to a stage and drives the real API
```

The first four are what CI runs (`.github/workflows/ci.yml`) on every push and
PR; they need no cloud account. `test:e2e` does — it deploys, asserts, and
destroys (ADR 0020) — so it stays out of CI until the branch has credentials.
Lefthook runs format and lint on staged files at commit time.

## Contributing

`AGENTS.md` (symlinked as `CLAUDE.md`) holds the rules that apply to every edit.
Read it before changing code. Decisions that are expensive to reverse get an ADR
in `docs/technical/adr/`; anything shipped or removed gets a `CHANGELOG.md`
entry in the same commit.
