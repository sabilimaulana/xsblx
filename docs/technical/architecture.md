---
status: active
version: 2.0.0
updated: 2026-08-20
---

# Architecture

Shape, layers, seams and known ceilings. Rules for editing code live in
`AGENTS.md`; decisions and their reasoning live in [ADRs](./adr/). This file
describes what is there.

## Workspaces

Bun workspace monorepo, TypeScript 7 throughout. Everything deploys to
Cloudflare through one alchemy stack (ADR 0019).

| Path             | Stack                                                                          | Deploys as                |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `alchemy.run.ts` | alchemy 2 (beta.70) — the whole deploy as one Effect program                   | the stack itself          |
| `apps/server`    | Effect 4 (beta.103), `HttpApi`, drizzle + `@effect/sql-d1` over a D1 binding   | `Cloudflare.Worker`       |
| `apps/web`       | TanStack Start + Query + Form (React 19, Vite 8, Tailwind 4)                   | `Cloudflare.Website.Vite` |
| `packages/api`   | Domain schemas + `HttpApi` definition, shared by server and web (`@xsblx/api`) | —                         |
| `packages/ui`    | shadcn `base-nova` preset (Base UI + Nova theme), published as `@xsblx/ui`     | —                         |

Scripts live in the root `package.json`: `dev` (`alchemy dev`), `plan`, `deploy`,
`destroy`, `tail`, `build`, `test`, `test:e2e`, `typecheck`, `lint`, `format`,
`format:check`. `bun run dev` serves the site on 3001 with HMR and binds it to
the real cloud resources; there is no separate `dev:server`, because the API
Worker is part of the same dev session.

Shared dependency versions live in the root `package.json` catalogs, not in each
workspace — `catalog:` for the common set (typescript, vite, react, tailwindcss,
drizzle), `catalog:effect` for `effect`, `@effect/sql-d1`, the platform packages
and `@effect/vitest`, which must stay on the same beta version (ADR 0002), and
`catalog:alchemy` for `alchemy` and `@alchemy.run/better-auth`, which move
together with `repos/alchemy`.

Configuration is one root `.env` (template `.env.example`), because `alchemy` is
what reads it: a `Config` value resolved in a Worker's init phase is bound onto
the deployed Worker as a secret. Two variables matter — `AUTH_SECRET` and
`CORS_ALLOWED_ORIGINS`. Cloudflare credentials are not in it; `alchemy login`
stores them in `~/.alchemy/profiles.json`, and CI passes
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` instead.

## The deploy

```
alchemy.run.ts                    one stack, "xsblx"
├── Drizzle.Schema  "Schema"      generates pending migration SQL → apps/server/drizzle/
├── D1.Database     "Database"    applies it (migrationsTable: drizzle_migrations)
├── R2.Bucket       "Assets"      public/avatars/<id>.svg
├── Worker          "Api"         apps/server/src/worker.ts — HttpApi + /api/auth/* + /public/*
└── Website.Vite    "Website"     apps/web — SSR Worker + static assets, VITE_API_URL = Api.url
```

The API Worker is public and the browser calls it directly, so CORS with
credentials is load-bearing (ADR 0008). The website consumes the API's URL as a
build-time `Output`; the API's allow-list comes from configuration, because taking
both edges would make the two Workers a cycle in the deploy graph.

| Command           | Does                                                    |
| ----------------- | ------------------------------------------------------- |
| `bun run dev`     | Vite dev server + HMR, bindings on real cloud resources |
| `bun run plan`    | diff the stack against recorded state                   |
| `bun run deploy`  | generate migrations, apply them, upload both Workers    |
| `bun run destroy` | remove everything in the stage                          |
| `bun run tail`    | stream Worker logs                                      |

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
| Persistence    | `apps/server/src/features/todos/schema.ts`       | Drizzle `sqliteTable`. Migrations are generated and applied by `alchemy deploy` (ADR 0020). |
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

Tests live beside the code they test. No `test/` directory.

`bun run test` is vitest and touches no database — what is left off-platform is
the endpoint contract (`http.test.ts`: defaults, bounds, string parsing).
Anything that needs rows is an end-to-end test against a deployed stage:
`*.e2e.test.ts` under `bun run test:e2e`, which deploys the stack with alchemy's
`Test` harness, drives the real API with the shared typed client, and destroys it
(ADR 0020). It needs Cloudflare credentials, which is why it is a separate
script.

## Auth

Better Auth 1.7.0-rc.4, email + password only. Runs outside the Effect runtime
and does not follow the slice (ADR 0007), and on a Worker it is a service rather
than a module singleton (ADR 0022).

| Layer     | File                                            | Responsibility                                                                                                             |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Service   | `apps/server/src/features/auth/auth.ts`         | `layerBetterAuth` — alchemy's `BetterAuth` tag, built once per isolate inside `Effect.cached` from the D1 and R2 bindings. |
| Schema    | `apps/server/src/features/auth/schema.ts`       | Auth tables, re-exported through the `db/schema.ts` barrel.                                                                |
| Relations | `apps/server/src/db/relations.ts`               | `defineRelations` — user↔sessions, user↔accounts. Passed to `Drizzle`.                                                     |
| Mount     | `apps/server/src/features/auth/http.ts`         | Raw `HttpRouter` route at `/api/auth/*`, plus `GET /public/*` for assets.                                                  |
| Avatars   | `apps/server/src/features/auth/avatar.ts`       | Random blobatar SVG per registration, written to R2 (ADR 0021).                                                            |
| Contract  | `packages/api/src/features/auth/middleware.ts`  | `Authentication` middleware, `CurrentUser`, `Unauthorized`.                                                                |
| Shared    | `packages/api/src/features/auth/credentials.ts` | Credential rules (`MIN_PASSWORD_LENGTH`, sign-in/up schemas).                                                              |
| Client    | `apps/web/src/lib/auth-client.ts`               | `createAuthClient` from `better-auth/react`.                                                                               |
| UI        | `apps/web/src/components/auth-form.tsx`         | One form, both modes. Routes `/signin`, `/signup`.                                                                         |

### Regenerating the auth tables

The `auth` CLI runs under node/jiti and cannot import the app's driver, so point
it at a throwaway config using
`drizzleAdapter({} as never, { provider: "sqlite" })`, generate to a scratch file,
then hand-merge the table definitions into `src/features/auth/schema.ts` as
`sqliteTable`s — booleans are `integer({ mode: "boolean" })`, instants are
`integer({ mode: "timestamp_ms" })`. Drop the generated `relations(...)` block —
drizzle 1.0-rc moved that API, and relations live in `src/db/relations.ts` via
`defineRelations`.

```
bunx auth@1.7.0-rc.4 generate --config src/auth.gen.ts --output /tmp/auth-schema.ts -y
# merge tables into src/features/auth/schema.ts, then:
bun run deploy   # Drizzle.Schema generates the migration, D1 applies it
```

## Object storage

One R2 bucket, declared as `Cloudflare.R2.Bucket("Assets")` in
`apps/server/src/assets.ts` and bound to the API Worker as a `ReadWriteBucket`
(ADR 0021). alchemy names it per stack, stage and logical id, so every stage has
its own.

| Prefix          | Read path                         | Holds                                     |
| --------------- | --------------------------------- | ----------------------------------------- |
| `public/*`      | `GET /public/*` on the API Worker | `public/avatars/<id>.svg` — user avatars  |
| everything else | none                              | nothing yet; `private/*` is where it goes |

The bucket is private: R2 serves anonymous reads only through a custom domain and
this stack owns no zone, so the Worker streams the object whose key is the request
path, after matching it against `^public/[A-Za-z0-9][A-Za-z0-9._/-]*$`. That
pattern is the access rule — the ACL SeaweedFS used to enforce — and responses
carry `cache-control: public, max-age=31536000, immutable` so the edge absorbs
repeat reads.

Writes happen in Better Auth's `databaseHooks.user.create.before`, outside the
Effect runtime (ADR 0007), through the binding's `raw` escape hatch — the native
`R2Bucket` promise API, no S3 client and no credentials. The stored URL is
absolute, built from `Cloudflare.Worker.URL`, because the web app is a different
origin.

## Observability

All three signals come from Effect itself and leave over OTLP to Axiom (ADR
0015, ADR 0023). Both ends are declared in the stack, and there is no SDK to
initialise — the exporter is a binding layer.

| Piece         | File                                        | Responsibility                                                                        |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Datasets      | `apps/server/src/observability.ts`          | One `Axiom.Dataset` per signal, named per stage, plus retention.                      |
| Credential    | `apps/server/src/observability.ts`          | `Axiom.ApiToken` — `ingest: ["create"]` on those three datasets and nothing else.     |
| Wiring        | `apps/server/src/worker.ts`                 | `Axiom.Telemetry({ token, traces, logs, metrics, serviceName })` in `Effect.provide`. |
| Instrumenting | `apps/server/src/features/todos/service.ts` | `Effect.fn("Todos.…")` spans; `todos_created_total` counter. The copyable pattern.    |

What each signal is:

- **Traces.** An `http.server` root span per request from the runtime, one span
  per service method from `Effect.fn`, nested under it. Incoming `traceparent` is
  honoured and Effect's `HttpClient` propagates it onward — which is why
  `traceparent` and `b3` are in the CORS allow-list (ADR 0008).
- **Logs.** Every `Effect.log*` record, with the span context attached. Effect's
  default minimum level (`Info`) applies; there is no `LOG_LEVEL` variable.
- **Metrics.** Effect's fiber runtime gauges plus declared `Metric`s.

Building the layer binds each dataset's OTLP endpoint as a plain var and the
token's `Authorization` header as a **secret** onto the Worker; at runtime the
exporters are built into each event's request scope and the flush is registered
with `ctx.waitUntil`, so export happens after the response is sent. Every signal
also carries `alchemy.stack` and `alchemy.stage` resource attributes, and
`service.name` is pinned to `xsblx-api` — the default is the Worker's generated
physical name, which changes per stage.

Datasets are `xsblx-<stage>-{traces,logs,metrics}`. Per stage, not shared: a
`Dataset` is a resource in that stage's state, so one shared name would let
`alchemy destroy` on a dev stage delete production's events.

Deploying these resources needs an Axiom credential, which is alchemy's business
rather than the app's: `alchemy login` reads `AXIOM_TOKEN` (or a stored token)
alongside the Cloudflare step. The Worker itself only ever carries the
ingest-only bearer.

Two things this deliberately does not do. **Nothing alerts** — `Axiom.Monitor` and
`Axiom.Notifier` are resources this stack does not declare, because a notifier
needs a destination that is a decision about who gets paged. And **the website
Worker exports nothing**: `Website.Vite` builds its Worker from Vite output and
has no init Effect to provide a layer to, so SSR is covered by Cloudflare's own
Workers Logs (`bun run tail`) and not by a trace.

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
TanStack's `onSubmit` are async by API contract. Auth's files are exempted
individually (ADR 0007), and `features/auth/middleware.ts` turns off
`strictEffectProvide` for the one `RuntimeContext.phantom` provide that erases a
type rather than building anything (ADR 0022).

## Tooling

oxlint (`.oxlintrc.json`) + oxfmt (`.oxfmtrc.json`) at the root, both run with
`--disable-nested-config` so they ignore the configs vendored under `repos/`.
lefthook (`lefthook.yml`) runs oxfmt (auto-staging fixes) then oxlint on staged
files at pre-commit; hooks install via the root `prepare` script.

`apps/web/src/routeTree.gen.ts` is generated by the vite plugin — never edited.

## Known ceilings

- **D1 is one SQLite database: single-writer, and capped in size** (10 GB at the
  time of writing). Writes serialise per database, and read replication is a
  per-database setting rather than a code change (ADR 0020). Revisit before the
  first million rows, not after.
- **There are no interactive transactions.** D1 takes one statement or a batch per
  round-trip; a Worker cannot hold `BEGIN` open across awaits. Nothing needs one
  today (ADR 0020).
- **An avatar read costs a Worker invocation.** The bucket is private, so
  `GET /public/*` runs the isolate and a subrequest on every cache miss (ADR
  0021). A custom domain would remove the hop and rewrite every stored URL.
- **Avatars are never deleted.** Deleting a user leaves its object in R2 — 880
  bytes per orphan, no lifecycle rule and no sweeper (ADR 0021).
- **An avatar URL is absolute and embeds the API Worker's origin.** Moving the
  read path rewrites every stored URL (ADR 0021).
- **List pages cannot be jumped to, and carry no total.** Lists are keyset
  paginated (ADR 0016), so a client follows `nextCursor` and there is no page
  number and no count. Adding either costs a `COUNT(*)` per request.
- **List ordering is welded to `createdAt` descending, tie-broken by `id`.**
  Sorting by any other column needs a different cursor and a matching index
  (ADR 0016, ADR 0017).
- **Instrumentation is no longer free.** Every span, log record and metric update
  is serialised and POSTed once per event (ADR 0023). It runs in `ctx.waitUntil`
  so the response is not delayed, but it is CPU on the Worker's budget and a
  subrequest per signal. The lever, if it bites, is sampling — not deleting spans.
- **The website Worker is invisible in a trace**, and so are auth routes: the
  first has no init Effect to provide the exporter to (ADR 0023), the second runs
  outside the Effect runtime (ADR 0007).
- **Nothing alerts, and the ingest bearer lives in resource state.** Monitors are
  undeclared, and Axiom hands the token over once at create time, so the state
  store is as sensitive as the token (ADR 0023).
- **Destroying a stage destroys its telemetry**, including the trace of the run
  you were reading. `NO_DESTROY=1` keeps an e2e stage alive (ADR 0023).
- **Debug logging in a deployed stage is a code change.** Effect's default
  minimum level applies and there is no `LOG_LEVEL` binding (ADR 0023).
- **Throughput is unmeasured on this branch.** `main`'s numbers — 12k req/s at
  `WORKERS=4`, bounded by Better Auth's per-request CPU rather than by the
  database — described a Bun process on one box and say nothing about an isolate
  per request. The mechanism they identified still applies: authenticated routes
  pay cookie verification outside the Effect runtime (ADR 0007), and it is
  charged per request regardless of what the endpoint does. Re-measure before
  quoting a number, and remember the session cookie cache has a 60s `maxAge` — a
  stale bench cookie measures the uncached path.
- **No per-request cache in `apps/web`.** `QueryClient` is module-scope and
  query-backed routes are `ssr: false` (ADR 0010). Server-rendering an
  authenticated route would need a per-request client.
- **The session cookie is third-party.** Two Workers on `workers.dev` are
  different sites, so the cookie is `SameSite=None; Secure` (ADR 0022) — which
  works in Chrome today, is blocked by Safari's ITP, and is partitioned by
  Firefox. Auth across the two Workers is therefore not dependable until both sit
  on one registrable domain.
- **`CORS_ALLOWED_ORIGINS` is per stage.** A deployed website's `workers.dev`
  hostname only exists after it deploys, and the API's allow-list cannot consume
  it without making the two Workers a cycle in the deploy graph (ADR 0019). Every
  new stage needs its origin added by hand until custom domains land.
- **Two origins.** CORS is load-bearing (ADR 0008). Routing the API through the
  website Worker would delete that surface — and add an SSR hop to every call.
- **Local development needs the cloud.** `alchemy dev` binds real D1 and R2, so
  there is no offline path and no emulator (ADR 0019).
- **Effect is pinned to a beta, and now alchemy is too** (ADR 0002, ADR 0019).
  They move together with the vendored sources in `repos/`.
