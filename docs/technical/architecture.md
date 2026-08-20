---
status: active
version: 1.2.0
updated: 2026-08-11
---

# Architecture

Shape, layers, seams and known ceilings. Rules for editing code live in
`AGENTS.md`; decisions and their reasoning live in [ADRs](./adr/). This file
describes what is there.

## Workspaces

Bun workspace monorepo, TypeScript 7 throughout.

| Path           | Stack                                                                               | Dev port |
| -------------- | ----------------------------------------------------------------------------------- | -------- |
| `apps/server`  | Effect 4 (beta.103) + `@effect/platform-bun`, `HttpApi`, drizzle + `@effect/sql-pg` | 3000     |
| `apps/web`     | TanStack Start + Query + Form (React 19, Vite 8, Tailwind 4)                        | 3001     |
| `packages/api` | Domain schemas + `HttpApi` definition, shared by server and web (`@xsblx/api`)      | —        |
| `packages/ui`  | shadcn `base-nova` preset (Base UI + Nova theme), published as `@xsblx/ui`          | —        |

Scripts live in the root `package.json`: `dev`, `dev:web`, `dev:server`, `build`,
`typecheck`, `lint`, `format`, `format:check`.

Shared dependency versions live in the root `package.json` catalogs, not in each
workspace — `catalog:` for the common set (typescript, vite, react, tailwindcss),
`catalog:effect` for `effect`, `@effect/platform-bun`, `@effect/sql-pg` and
`@effect/vitest`, which must stay on the same beta version (ADR 0002).

Env vars are per app (`apps/server/.env`, template `apps/server/.env.example`),
because Bun loads the `.env` in the cwd. There is no repo-root `.env`.
`apps/server` needs `DATABASE_URL`, `AUTH_URL`, `AUTH_SECRET`,
`CORS_ALLOWED_ORIGINS`. Observability variables are optional — see below.

## Import paths

- Workspace packages are `@xsblx/*`. UI imports as `@xsblx/ui/components/<name>`,
  `@xsblx/ui/lib/utils`, `@xsblx/ui/globals.css`. `lib/utils` re-exports `cn` from
  `cnfast`, which replaces the usual `clsx` + `tailwind-merge` pair — the path
  stays because shadcn generates imports against it.
- `packages/api` exports one subpath per feature file — `@xsblx/api/<feature>/<file>`
  via `"./*": "./src/features/*.ts"` — plus `@xsblx/api/api` for the root.
- Inside `apps/web`, `@/*` maps to `apps/web/src/*`. It is the only in-app alias.

## The `todos` slice

The worked reference, DB → HTTP → UI. Feature-first: one directory per package,
the layer is the filename (ADR 0005).

| Layer          | File                                             | Responsibility                                                                              |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Domain         | `packages/api/src/features/todos/schema.ts`      | `Schema.Class` + branded id. No IO, no framework types.                                     |
| Domain errors  | `packages/api/src/features/todos/errors.ts`      | `Schema.TaggedErrorClass` per case, plus one `TodosError` wrapper holding them in `reason`. |
| API definition | `packages/api/src/features/todos/group.ts`       | `HttpApiGroup` — paths, params, payloads, declared errors. No handler logic.                |
| API root       | `packages/api/src/api.ts`                        | Composes every group into `Api`.                                                            |
| Persistence    | `apps/server/src/features/todos/schema.ts`       | Drizzle table. `bun run db:generate` then `db:migrate`.                                     |
| Service        | `apps/server/src/features/todos/service.ts`      | `Context.Service` + `Layer`. Owns business rules and SQL; maps rows to domain types.        |
| Handlers       | `apps/server/src/features/todos/http.ts`         | `HttpApiBuilder.group` — translates HTTP ↔ domain and nothing else.                         |
| Wiring         | `apps/server/src/index.ts`                       | Provides handler layers to the server.                                                      |
| Client         | `apps/web/src/lib/api-client.ts`                 | `HttpApiClient` over the shared `Api`, a `ManagedRuntime`, and the `effect-query` bridge.   |
| UI             | `apps/web/src/routes/_protected/todos.tsx`       | `useInfiniteQuery` pages, TanStack Form submits, `invalidateQueries` refetches.             |
| Test           | `apps/server/src/features/todos/service.test.ts` | `@effect/vitest` `layer(...)` integration test against real Postgres.                       |
| Contract test  | `apps/server/src/features/todos/http.test.ts`    | Decodes the endpoint's built query schema — defaults, bounds, string parsing. No database.  |

Central by necessity, not feature-folded:

- `apps/server/src/db/schema.ts` — barrel re-exporting every
  `features/*/schema.ts`. drizzle-kit takes one schema entry, and
  `defineRelations` in `db/relations.ts` needs all tables at once.
- `packages/api/src/api.ts` — composes the groups. Only job.

`GET /todos` is the worked example of a **paginated, filtered read** (ADR 0016):
query params are a field record on the endpoint, defaults and the page cap live
in the schema, the service seeks by keyset on `(userId, createdAt DESC, id DESC)`
— ids are unordered nanoids (ADR 0017), so `createdAt` sorts and `id` breaks
ties — and returns
`TodoPage { items, nextCursor }`, and the UI pages with
`eq.infiniteQueryOptions`. Copy that shape for any list endpoint.

Tests live beside the code they test (`src/**/*.test.ts`). No `test/` directory.

`apps/server/src/test-db.ts` and `src/test-setup.ts` are the suite's own
plumbing, not a feature: `.env.test` supplies `DATABASE_URL`, the real migrations
run before the suite, and every table is truncated before each test (ADR 0004).

## Auth

Better Auth 1.7.0-rc.4, email + password only. Runs outside the Effect runtime
and does not follow the slice (ADR 0007).

| Layer     | File                                            | Responsibility                                                              |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Config    | `apps/server/src/features/auth/auth.ts`         | `betterAuth(...)` + `drizzleAdapter`. Own `drizzle-orm/bun-sql` connection. |
| Schema    | `apps/server/src/features/auth/schema.ts`       | Auth tables, re-exported through the `db/schema.ts` barrel.                 |
| Relations | `apps/server/src/db/relations.ts`               | `defineRelations` — user↔sessions, user↔accounts. Passed to `Drizzle`.      |
| Mount     | `apps/server/src/features/auth/http.ts`         | Raw `HttpRouter` route at `/api/auth/*`.                                    |
| Avatars   | `apps/server/src/features/auth/avatar.ts`       | Random blobatar SVG per registration, written to object storage (ADR 0018). |
| Contract  | `packages/api/src/features/auth/middleware.ts`  | `Authentication` middleware, `CurrentUser`, `Unauthorized`.                 |
| Shared    | `packages/api/src/features/auth/credentials.ts` | Credential rules (`MIN_PASSWORD_LENGTH`, sign-in/up schemas).               |
| Client    | `apps/web/src/lib/auth-client.ts`               | `createAuthClient` from `better-auth/react`.                                |
| UI        | `apps/web/src/components/auth-form.tsx`         | One form, both modes. Routes `/signin`, `/signup`.                          |

### Regenerating the auth tables

The `auth` CLI runs under node/jiti and cannot import `drizzle-orm/bun-sql`, so
point it at a throwaway config using `drizzleAdapter({} as never, { provider: "pg" })`,
generate to a scratch file, then hand-merge the table definitions into
`src/features/auth/schema.ts`. Drop the generated `relations(...)` block —
drizzle 1.0-rc moved that API, and relations live in `src/db/relations.ts` via
`defineRelations`.

```
bunx auth@1.7.0-rc.4 generate --config src/auth.gen.ts --output /tmp/auth-schema.ts -y
# merge tables into src/features/auth/schema.ts, then:
bun run db:generate && bun run db:migrate
```

## Object storage

SeaweedFS (`compose.yaml`, service `seaweedfs`) runs master, volume, filer and S3
gateway in one container and is reached through its S3 API on `:8333`. Not in a
profile — host development needs it like it needs Postgres.

One bucket, `xsblx`, and the prefix is the access rule (ADR 0018):

| Prefix          | Who can read it    | Holds                                     |
| --------------- | ------------------ | ----------------------------------------- |
| `public/*`      | anyone, unsigned   | `public/avatars/<id>.svg` — user avatars  |
| everything else | signature required | nothing yet; `private/*` is where it goes |

The identity file is written by the container entrypoint from `S3_ACCESS_KEY` and
`S3_SECRET_KEY`, and `seaweedfs-init` creates the bucket once through
`weed shell`. Avatars are generated in
`apps/server/src/features/auth/avatar.ts` — `blobatar` markup uploaded with
Bun's `S3Client` from Better Auth's user-create hook, outside the Effect runtime
with the rest of auth (ADR 0007).

`S3_ENDPOINT` is what the server talks to; `S3_PUBLIC_URL` is the origin baked
into the stored URL, because a browser cannot resolve `seaweedfs`.

Tests that touch the store are `*.bun.test.ts` and run under `bun test` — they
import the `bun` module, which node cannot resolve.

## Observability

All three signals come from Effect itself and leave over OTLP/HTTP (ADR 0015).
Infrastructure, not a slice — there is no `features/observability/`.

| Piece         | File                                        | Responsibility                                                                     |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Config        | `apps/server/src/config.ts`                 | `ObservabilityConfig` — endpoint, service name, log level, log format.             |
| Layer         | `apps/server/src/observability.ts`          | Logger, minimum level, OTLP span processor and metric reader.                      |
| Wiring        | `apps/server/src/index.ts`                  | `Layer.provide(ObservabilityLive)` beneath the server layer.                       |
| Instrumenting | `apps/server/src/features/todos/service.ts` | `Effect.fn("Todos.…")` spans; `todos_created_total` counter. The copyable pattern. |

What each signal is:

- **Logs.** `Logger.consoleJson` or `Logger.consolePretty()` by `LOG_FORMAT`,
  threshold from `LOG_LEVEL`. Written to stdout for a collector to pick up — logs
  are not pushed over OTLP.
- **Traces.** `http.span` per request from `HttpApi`, one span per service method
  from `Effect.fn`. Batched to `${endpoint}/v1/traces`.
- **Metrics.** Effect's fiber runtime gauges plus declared `Metric`s, pushed to
  `${endpoint}/v1/metrics` every 60s and on shutdown.

Everything is gated on one variable. With `OTEL_EXPORTER_OTLP_ENDPOINT` unset the
span processor and metric reader are not installed at all, and the process makes
no network calls — which is how the repo runs out of the box.

| Variable                      | Default                |
| ----------------------------- | ---------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset — export nothing |
| `OTEL_SERVICE_NAME`           | `xsblx-server`         |
| `LOG_LEVEL`                   | `Info`                 |
| `LOG_FORMAT`                  | by `NODE_ENV`          |

A local backend is a compose profile, per ADR 0014. It runs Prometheus, Tempo,
Loki and Grafana in one container, so a single endpoint takes all three signals —
a traces-only backend silently 404s the metrics:

```
docker compose --profile otel up -d   # otel-lgtm: OTLP on :4318, Grafana on :3002
# then set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
#                          (http://otel:4318 from inside another container)
```

Two gotchas that cost real time, both recorded in ADR 0015: import
`@effect/opentelemetry` **by subpath** (the package root re-exports `WebSdk` and
fails at startup), and keep the SDK layer out of `Layer.mergeAll` (parallel
construction leaves its own `Resource` unsatisfied — use `Layer.provideMerge`).

## Type-checking: `@effect/tsgo`

Every workspace type-checks with `@effect/tsgo` — TypeScript 7 (`tsgo`) patched
with the Effect language service. Already wired up; do not re-run
`effect-tsgo setup`.

`bun run typecheck` reports Effect diagnostics (`TS377001 floatingEffect` and
friends) alongside normal type errors.

`@effect/tsgo` is a **root** devDependency, patched by the root `prepare` script
(`effect-tsgo patch --typescript --no-oxlint`). It patches the hoisted
`typescript` at the repo root, so it affects every workspace. Re-run
`bun install` if `tsc` stops emitting Effect diagnostics.

Plugin config lives once in the root `tsconfig.effect.json`; `apps/server`,
`apps/web` and `packages/api` `extends` it. `extends` replaces the whole
`plugins` array, so an app that restates it silently drops every shared rule —
edit severities only in the root file. Override `include` patterns there resolve
relative to the **consuming** tsconfig's directory, so keep them recursive
(`**/*.config.ts`), never root-prefixed (`apps/web/**` matches nothing).

Severities are configured in `tsconfig.effect.json` and that file is the
reference. In summary: correctness rules and the whole `effect-native` preset are
`error`; refactor hints stay at the default `suggestion`; pure style rules are
`off`.

Scoped `overrides` exist for code that legitimately runs outside the Effect
runtime — `**/*.config.ts`, and `**/*.tsx` + `**/routes/**` where React and
TanStack's `onSubmit` are async by API contract. Auth's three files are exempted
individually (ADR 0007).

## Tooling

oxlint (`.oxlintrc.json`) + oxfmt (`.oxfmtrc.json`) at the root, both run with
`--disable-nested-config` so they ignore the configs vendored under `repos/`.
lefthook (`lefthook.yml`) runs oxfmt (auto-staging fixes) then oxlint on staged
files at pre-commit; hooks install via the root `prepare` script.

`apps/web/src/routeTree.gen.ts` is generated by the vite plugin — never edited.

## Known ceilings

- **Avatars are never deleted.** Deleting a user leaves its SVG in the bucket —
  880 bytes per orphan, with no lifecycle rule and no sweeper (ADR 0018). The
  answer at volume is a delete hook or a nightly reconcile against `user.image`.
- **An avatar URL is absolute and embeds the store's public origin.** Moving the
  store rewrites every stored URL (ADR 0018).
- **List pages cannot be jumped to, and carry no total.** Lists are keyset
  paginated (ADR 0016), so a client follows `nextCursor` and there is no page
  number and no count. Adding either costs a `COUNT(*)` per request.
- **List ordering is welded to `createdAt` descending, tie-broken by `id`.**
  Sorting by any other column needs a different cursor and a matching index
  (ADR 0016, ADR 0017).
- **The keyset cursor is only correct at millisecond precision.** `todos.createdAt`
  is `timestamp(3)` because the cursor encodes a JS `Date`. Widening the column
  without widening the cursor format repeats a row per page boundary (ADR 0017).
- **Authenticated throughput is bounded by per-request auth CPU, not by Postgres
  and not by the HTTP layer.** `autocannon` against the container image, authed
  `GET /todos`, session cookie cache warm:

  | Config             | req/s  | Note                          |
  | ------------------ | ------ | ----------------------------- |
  | `/health`, no auth | 49,000 | Bun + Effect router + encode  |
  | `WORKERS=1`        | 5,276  | one core saturated (134% CPU) |
  | `WORKERS=2`        | 9,907  |                               |
  | `WORKERS=4`        | 12,050 | peak on a 10-core machine     |
  | `WORKERS=6`        | 10,950 | contention                    |
  | `WORKERS=10`       | 6,751  | oversubscribed, worse than 4  |

  Postgres is not the constraint: it sits at **0.09% CPU** under load, and a
  transaction count shows `/todos` doing ~1 query per request while
  `/api/auth/get-session` does 2 per _200_ requests once the cookie cache is warm.
  What remains is Better Auth's own per-request work — routing plus verifying,
  parsing and validating the signed cookie — which runs outside the Effect runtime
  (ADR 0007) and is charged to every authenticated route regardless of what the
  endpoint does.

  Two traps this measurement walked into, both worth avoiding when re-running it.
  The cookie cache has a **60s `maxAge`**: a bench cookie older than that silently
  measures the uncached DB path (~3.8k, and flat under worker scaling, because
  that path _is_ I/O-bound). And **SO_REUSEPORT only load-balances on Linux** —
  on macOS the kernel hands every connection to one socket, so extra workers idle
  at 0% CPU and clustering looks like a no-op. Benchmark worker counts in the
  container, never on the host.

  Next lever, if 12k is ever the constraint: verify the signed cookie inside the
  Effect middleware and call `auth.api.getSession` only on a cache miss. That
  reimplements a Better Auth format ADR 0007 deliberately avoids, so it needs its
  own ADR — and a second datastore for sessions is not the answer.

- **Auth routes produce no spans.** Better Auth runs outside the Effect runtime
  (ADR 0007), so `/api/auth/*` is invisible in a trace — including the
  per-request auth CPU that bounds the throughput measured above.
- **Metrics are per-process, so always aggregate.** Each worker exports its own
  series, told apart by `service.instance.id` (the pid). A bare
  `todos_created_total` reads one worker's count; `sum(todos_created_total)` is
  the real number. Without that attribute the series carry identical labels and
  silently overwrite each other.
- **No HTTP request metrics from the app.** Effect's server emits none and
  `HttpMiddleware` has no metrics member. The local backend derives
  `traces_spanmetrics_*` from span data instead, which covers request rate and
  latency without custom middleware — but that is the backend's doing, not the
  server's, and a different backend may not.
- **Metrics resolve at 60s** and the reader reads no environment variable, so a
  finer interval is a code change in `observability.ts`.
- **No per-request cache in `apps/web`.** `QueryClient` is module-scope and
  query-backed routes are `ssr: false` (ADR 0010). Server-rendering an
  authenticated route would need a per-request client.
- **Two origins.** CORS is load-bearing (ADR 0008). A single-origin reverse proxy
  would delete that surface.
- **Effect is pinned to a beta** on a third-party constraint (ADR 0002).
