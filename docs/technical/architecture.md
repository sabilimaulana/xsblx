---
status: active
version: 2.1.0
updated: 2026-08-26
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
| `alchemy.run.ts` | alchemy 2 (commit `e05c734`) — the whole deploy as one Effect program          | the stack itself          |
| `apps/server`    | Effect 4 (rc.112), `HttpApi`, drizzle + `@effect/sql-d1` over a D1 binding     | `Cloudflare.Worker`       |
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
├── D1.Database     "Database"    applies it (migrations: Schema, ledger __alchemy_migrations)
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
  [`cn`](https://github.com/shadcn-ui/cn), which replaces the usual `clsx` +
  `tailwind-merge` pair — the path stays because shadcn generates imports
  against it.
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

Better Auth 1.7.2, email + password only. Runs outside the Effect runtime
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
bunx auth@1.7.2 generate --config src/auth.gen.ts --output /tmp/auth-schema.ts -y
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

Cloudflare records it, and there is nothing else (ADR 0025). Telemetry is a
property of each Worker rather than a set of resources with a vendor behind
them — a boolean per signal in the script's metadata, no dataset to declare, no
ingest token to carry, and nothing that scales with the number of stages.

| Piece         | File                                        | Responsibility                                                                      |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Configuration | `apps/server/src/config.ts`                 | `apiObservability` (logs only) and `websiteObservability` (logs + traces).          |
| Wiring        | `apps/server/src/worker.ts`                 | The prop, `Cloudflare.Telemetry()`, and `Logger.consoleStructured` in the layers.   |
| Wiring        | `alchemy.run.ts`                            | `websiteObservability` on the website Worker.                                       |
| Instrumenting | `apps/server/src/features/todos/service.ts` | `Effect.fn("Todos.…")` span names. The copyable pattern.                            |

What each signal is:

- **Traces.** Cloudflare's automatic tracing: the fetch handler, D1 statements,
  R2 operations, subrequests. Both Workers, so SSR and `/api/auth/*` are visible.
  On the API Worker, `Cloudflare.Telemetry({ headSamplingRate: 1 })` adds
  Effect's own spans to the same waterfall, so an `Effect.fn("Todos.list")` frame
  nests between the fetch span and the D1 statement it issues (ADR 0026). Scalar
  `Effect.annotateCurrentSpan` values are forwarded; events, links and
  non-scalars stay Effect-local, and completion arrives as an `effect.exit`
  attribute of `success`, `failure` or `interrupted`. The website Worker has no
  Effect runtime, so its trace is the platform's alone.
- **Logs.** Every `Effect.log*` record, written as an _object_ by
  `Logger.consoleStructured` and indexed by Workers Logs into queryable fields.
  `Logger.consoleJson` is the wrong half of that pair here: it stringifies, and a
  logged string is one opaque message rather than a set of columns. Cloudflare
  attributes console output to the active platform span, so logs and traces
  correlate without carrying a trace id of their own. Effect's default minimum
  level (`Info`) applies; there is no `LOG_LEVEL` variable.
- **Metrics.** None. The telemetry layer provides a `Tracer` and nothing else,
  so there is still no sink for a `Metric` and therefore no `Metric` —
  `todos_created_total` went with the exporter.

`traces.propagationPolicy` is left at its default `"authenticated"`. `"accept"`
would adopt a caller's inbound `traceparent` as Cloudflare's trace id, which
makes the trace id forgeable by anyone who can reach the API. The CORS
allow-list still carries `traceparent` and `b3` regardless — Effect's
`HttpClient` in the browser sends them either way, and dropping them fails the
preflight silently (ADR 0008).

Two things this deliberately does not do. **Nothing alerts** — Cloudflare
Notifications is the un-declared half, and it needs the same undecided answer
about who gets paged. And **nothing is exported off Cloudflare**:
`Cloudflare.Workers.ObservabilityDestination` models an OTLP destination and
`observability.{logs,traces}.destinations` takes its slug, so pushing to a third
party later needs none of this undone — but it would export what Cloudflare sees,
never what Effect emits.

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
- **The website Worker's trace stops at the platform boundary.** `Website.Vite`
  has no init Effect and no Effect runtime in the SSR bundle, so there is nothing
  to install a `Tracer` into: its depth is whatever Cloudflare instruments
  automatically. The API Worker no longer has this ceiling (ADR 0026).
- **The API Worker's compatibility date is pinned to `2026-08-25` and cannot go
  below `2026-07-28`.** `tracing.startActiveSpan` does not exist before that, and
  the deploy fails with `CloudflareTelemetryCompatibilityError` rather than
  silently dropping spans.
- **`Metric` updates are still built on every request and discarded** should one
  ever be declared. Spans are not: `isTraced` on the Cloudflare span cascades
  into Effect's `sampled` flag, so an untraced invocation skips the whole
  subtree.
- **Telemetry is retained for 3 days, or 7 on Workers Paid.** An incident older
  than a week is not reconstructable. Logpush to R2 is the escape hatch and is
  not declared (ADR 0025).
- **Nothing alerts.** Cloudflare Notifications is undeclared, because a
  notification needs a destination that is a decision about who gets paged
  (ADR 0025).
- **Destroying a stage destroys its telemetry**, including the trace of the run
  you were reading — it belongs to the Worker. `NO_DESTROY=1` keeps an e2e stage
  alive (ADR 0025).
- **Debug logging in a deployed stage is a code change.** Effect's default
  minimum level applies and there is no `LOG_LEVEL` binding (ADR 0025).
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
