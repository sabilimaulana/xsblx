# xsblx

Rules for editing this repo. Every line here is a constraint you can violate.

Descriptions of the system live in `docs/technical/architecture.md`; the reasoning
behind each decision lives in `docs/technical/adr/`. This file does not restate
them — it cites the ADR number. Read `docs/README.md` before adding or superseding
a doc.

Three writing duties, none optional:

- **A choice that is expensive to reverse gets an ADR** — a dependency, a data
  model, a boundary, a pinned version, or a deliberate non-adoption. Write it
  before the code, and cite it from here in one line.
- **A user-facing feature starts from a PRD** (`docs/product/prd-template.md`).
  Its implementation steps are one commit each.
- **Anything shipped or removed gets a `CHANGELOG.md` entry in the same commit.**
  What changed, not why; link the ADR for why.

A standing rule about how work is done belongs in this file, not an ADR. Test:
can a later decision supersede it? → ADR. Do you obey it on every edit? → here.

When this file and a doc disagree: this file wins for code, docs win for intent,
and one of them is stale. Fix both in the same change.

## Engineering Priorities

Ranked. When two conflict, the higher one wins.

1. **Correct design over backward compatibility.** There is no external API contract to protect. If the right shape requires renaming everything, moving modules, changing the DB schema, or rewriting a whole app, do it — do not add a compatibility shim, a deprecated alias, a `v2` variant, or a feature flag to keep an old path alive. Delete the old path in the same change.
2. **Scalability.** Prefer designs that hold at 100x current load: bounded concurrency, streaming over buffering whole payloads, pagination over unbounded queries, indexed access paths, stateless request handlers. State the ceiling out loud when taking a shortcut, and record it in `architecture.md`.
3. **Separation of concerns.** One module, one reason to change. HTTP shape, domain logic and persistence stay in separate modules; handlers translate, they do not hold business rules. Domain code depends on service interfaces (`Context.Service` + `Layer`), never on a concrete client.

Corollaries:

- Big migrations and rewrites are acceptable and need no justification by size. Propose the end state, then execute it in full — a half-migrated codebase carrying both patterns is worse than either pattern alone.
- No dead code left behind. Removing the last caller means removing the callee.
- **No shallow abstractions.** An abstraction must hide more than it adds. A pass-through wrapper, an interface with one implementation, a factory for one product, a config for a value that never changes, a rename in a new file — inline it and delete the file. Prefer one deep module with a small interface over three that forward a call. Not a licence to collapse the seams the slice mandates: `http.ts` is thin on purpose, and a `Context.Service` with one `Layer` is a testability seam (ADR 0003).
- Migrations are destructive-forward: change the schema to what it should be. No legacy columns, no dual-write paths.

None of this overrides: input validation at trust boundaries, error handling that
prevents data loss, or the Effect rules below.

## Effect

Effect is required for all effectful and structured code. Do not introduce
another library for anything Effect already provides.

- **Read `repos/effect/LLMS.md` before writing any Effect code.** `repos/effect/`
  is the API source of truth, vendored at the exact runtime version.
- **Effect is pinned to `4.0.0-beta.103`. Never bump it or its companions
  individually** (ADR 0002). Consequences that bite daily: errors are
  `Schema.TaggedErrorClass<Self>()(tag, fields, annotations)`, **not**
  `Schema.TaggedError`; drizzle queries are Effects failing with `SqlError`, so
  `Effect.orDie` them in services rather than widening a domain error channel.
- Bump versions through the root `package.json` catalogs, never in a single
  workspace.

### Observability

Effect owns all three signals; never add another library for them (ADR 0015).
They ship to Axiom, and both ends are declared in the stack (ADR 0023): datasets
and an ingest-only token in `apps/server/src/observability.ts`, and
`Axiom.Telemetry` in the Worker's single `Effect.provide`. There is no SDK to
initialise and no OTLP env var to set.

- **A service method is declared with `Effect.fn("Todos.list")`, not a bare
  generator.** The name is the span name — `Feature.method`. Dropping it makes
  the feature invisible in a trace.
- **Log through `Effect.log*`.** Never `console.log`: it bypasses the configured
  logger, the level filter and the span context.
- **A metric answers what a trace cannot.** Spans already carry per-call latency
  and counts, so reach for `Metric` only for a total or a distribution no single
  trace shows. One per feature is usually too many.
- **A dataset is named per stage.** It is a resource in _that_ stage's state, so
  a shared name means `alchemy destroy` on a dev stage deletes production's
  events (ADR 0023).
- **Import a barrel-shaped package by subpath.** `alchemy/Drizzle` eagerly loads
  its MySQL and Postgres drivers, whose optional peers are not installed —
  `alchemy/Drizzle/D1`, `/Schema`, `/Providers`. Same trap as
  `@effect/opentelemetry`'s root re-export of `WebSdk`.
- **`Axiom.providers()` publishes the `HttpClient` the other provider layers
  consume**, so it goes into the merge with `Layer.provideMerge`, never beside
  them in `Layer.mergeAll` — parallel construction leaves that unsatisfied.

### @effect/tsgo

- `bun run typecheck` emits Effect diagnostics (e.g. `TS377001 floatingEffect`).
  Treat them as errors, not lint noise.
- **Edit rule severities only in the root `tsconfig.effect.json`.** `extends`
  replaces the whole `plugins` array, so restating it in an app silently drops
  every shared rule.
- **Never downgrade a rule repo-wide to unblock one file.** Code that legitimately
  runs outside the Effect runtime gets a scoped entry in the plugin's `overrides`.
- Do not re-run `effect-tsgo setup`; it is already wired up. Bump `@effect/tsgo`
  when bumping `effect`.

## Code layout

- **Feature-first: one feature is one directory per package, and the layer is the
  filename** (ADR 0005). Copy `features/todos/`; if a feature cannot follow it,
  say why before diverging.
- **Four files stay central and are not feature-folded:**
  `apps/server/src/db/schema.ts` (barrel of every `features/*/schema.ts`),
  `packages/api/src/api.ts` (composes the groups — its only job),
  `apps/server/src/worker.ts` (binds resources, assembles the router — it holds
  no business rules) and the root `alchemy.run.ts` (the whole deploy, ADR 0019).
- **Schemas, the `HttpApi` definition and domain errors live in `packages/api`**
  (ADR 0001). Never import from `apps/server` into `apps/web`.
- **Services return domain errors only** (ADR 0003). Infrastructure failures are
  `Effect.orDie` — they are bugs, not outcomes. One wrapper error per domain.
- **Row types never escape the service.** `toDomain` converts at the boundary.
- **A list endpoint is keyset-paginated or it is wrong** (ADR 0016). Query params
  are a field record on the endpoint, the default and the cap live in that
  schema, the response is `{ items, nextCursor }`, and the index covers
  `(owner, sortColumn)`. No `OFFSET`, no unbounded `select()`.
- **The schema is `drizzle-orm/sqlite-core`, and D1 is the database** (ADR 0020).
  A boolean is `integer({ mode: "boolean" })`, an instant is
  `integer({ mode: "timestamp_ms" })`. Never `pgTable`, never `@effect/sql-pg`.
  Services take the `Db` tag; `worker.ts` is the only place a client is built.
- **Migrations are generated by the deploy, never by hand.** `Drizzle.Schema`
  diffs `db/schema.ts` into `apps/server/drizzle/` and D1 applies it in the same
  `alchemy deploy`. Never add `drizzle-kit` scripts, a `drizzle.config.ts` or a
  `migrate.ts` back.
- **Ids are 21-character nanoids over `0-9A-Za-z`** (ADR 0017). Generate them
  with `newId` from `apps/server/src/id.ts` — never `crypto.randomUUID`, never a
  serial column. The shape is `IdString` in `packages/api/src/id.ts`; brand it
  per feature. A list's sort key is `(createdAt, id)`, because a nanoid does not
  sort.
- **Handlers hold no business rules.** They map service error reasons onto the
  endpoint's declared errors; an unexpected reason is `Effect.die`.
- **A D1-backed service has no off-platform test** (ADR 0020). `*.test.ts` is
  for what needs no binding — the endpoint's query contract, a schema, a pure
  function — and runs under `bun run test`. Anything that needs a database is
  `*.e2e.test.ts`: it deploys the stack with alchemy's `Test` harness, drives the
  real API, and runs under `bun run test:e2e` with credentials. Both live beside
  the code they test. No `test/` directory, no hand-written in-memory fake.
- Source files are lowercase (`api.ts`, `http.ts`) except React components, which
  follow the shadcn/TanStack conventions already in place.
- `apps/web/src/routeTree.gen.ts` is generated — never edit it.

## Web

- **Do not add a second owner for state that has one** (ADR 0010): server reads
  are TanStack Query + `invalidateQueries`, form state is TanStack Form, and
  Effect reaches React only through `eq` / `api` in `apps/web/src/lib/api-client.ts`.
- **Route loaders never carry server data.** The router serializes loader results
  and throws on class instances. Prefer `Schema.DateFromString` over
  `Schema.DateTimeUtc` on anything the web reads.
- **Every query-backed route sets `ssr: false`** — the session cookie is
  browser-only, so an SSR pass gets a 401.
- **The build is plain `vite build`, driven by `Cloudflare.Website.Vite`** (ADR
  0019): one pass emits the client assets and the SSR Worker bundle. Keep
  `vite.config.ts` pure — plugins only — and **never add `@cloudflare/vite-plugin`**,
  which alchemy's own Cloudflare plugin is not compatible with. There is no
  Nitro, no `.output/`, and no `start` script.
- **Do not set `assets.runWorkerFirst` on the website.** It sends `/assets/*` to
  the SSR Worker, which has no route for them and 404s every stylesheet and
  chunk — while the document itself still renders 200, so a smoke test that only
  checks `/` passes. Checking a deploy means checking a stylesheet returns 200.
- **Do not install `@effect-atom/atom-react`** for request/response. It is for
  push state a query cannot model (a live `Stream`), and nothing here needs that.
- **Effect `Schema` is the only validator** (ADR 0009). Forms validate against the
  API's own schema via `Schema.toStandardSchemaV1`. Never restate a validation
  rule in a component.
- **CORS is load-bearing** (ADR 0008). It must keep `credentials: true`, take
  origins from `CORS_ALLOWED_ORIGINS` and never a wildcard, and keep
  `traceparent` and `b3` in the header allow-list — Effect's `HttpClient` sends
  them, and omitting them fails the preflight silently.

### Exactly one workspace may depend on `vite`

**Only `apps/web`** (ADR 0006). A second dependent makes bun install two
peer-variants, `@tanstack/start-plugin-core`'s `instanceof` check fails, the SSR
middleware is never installed, and **every route 404s with `Cannot GET /`** — no
error, no warning. If that symptom appears:
`ls node_modules/.bun | grep '^vite@'`. It is also why `apps/server` never
reaches for vite's `loadEnv`, and why the root `alchemy.run.ts` declares the
website with `rootDir` instead of taking a vite dependency of its own — alchemy
loads `apps/web`'s own vite install.

## Cloudflare

**The deploy is one alchemy program: the root `alchemy.run.ts`, two Workers**
(ADR 0019). There is no Dockerfile, no compose file, and no local Postgres or
object store to start. `bun run dev` is `alchemy dev` — Vite with HMR, bindings
pointed at the real cloud resources.

- **A resource is declared once, where it is used, and bound with one `yield*`.**
  Never write a `wrangler.jsonc`, a `wrangler.toml` or a second stack file.
- **`alchemy` is pinned to `2.0.0-beta.70` — the tag `scripts/vendor.sh` fetches.**
  Bump the dependency and the vendored source together, never one alone, the way
  `effect` and `repos/effect` already move.
- **Paths depend on whether the Worker bundles the file.** `alchemy` runs from
  the workspace root, so a bare relative path resolves against the root, not
  against the declaring file. Two cases, and mixing them up breaks production:
  - **A module the Worker bundles** — anything `yield*`ed in its init phase, like
    `db/database.ts` — takes **plain root-relative strings** (`"./apps/server/src/db/schema.ts"`).
    The init phase runs at runtime too, and `new URL(…, import.meta.url)` throws
    `TypeError: Invalid URL string` in workerd, before routing, on every request.
    A string is inert at runtime; only the provider resolves it, under Bun, at
    deploy time.
  - **A module only the CLI loads** — `alchemy.run.ts` — may anchor with
    `fileURLToPath(new URL(…, import.meta.url))`. `main: import.meta.url` is
    always fine: it is read, never parsed.
- **A Worker's init phase only constructs.** Building layers and binding
  resources is safe there — it runs at plan time too. Anything that needs a
  request belongs in the returned handler.
- **`Config` is resolved in the init phase or it is not bound.** That is what
  turns `AUTH_SECRET` into a secret on the deployed Worker; a `Config` first read
  inside a handler is missing at runtime.
- **`HttpPlatform.layer` cannot be provided** — an isolate has no filesystem.
  `worker.ts` provides the stub; do not reach for file responses.

## UI components

**Check the shadcn registry before hand-writing any primitive** (ADR 0011):

1. Search — `shadcn` MCP `search_items_in_registries`, or `bunx shadcn@latest search <term>`.
2. Install into the UI package: `bunx shadcn@latest add <name> -c packages/ui`.
3. Only hand-write when the registry has nothing that fits, and say so.

A hand-rolled version of something shadcn ships is a bug, not a shortcut.
Customise by editing the installed file in `packages/ui/src/components/` — never
add a wrapper layer just to change styling. All Tailwind lives in
`packages/ui/src/styles/globals.css`; `apps/web` has no stylesheet of its own.
Composing installed components into an app-specific component is expected.

## Auth

Better Auth runs **outside** the Effect runtime and does not follow the slice
(ADR 0007), and on a Worker it is a service rather than a singleton (ADR 0022).
Read both before touching auth. Rules that are load-bearing:

- **Auth routes are not in `packages/api`.** Better Auth owns that contract.
- **Take the `BetterAuth` service; there is no importable `auth`.** The instance
  is built once per isolate inside `Effect.cached`, from bindings that only exist
  during a request. Never call `betterAuth(...)` at module scope.
- **The response goes back through `HttpServerResponse.fromWeb`** — it splits
  `set-cookie` with `getSetCookie()`. Flattening headers into a record merges
  multiple cookies into one broken one.
- **Credential rules live once**, in `packages/api/src/features/auth/credentials.ts`.
- **Session cookies are `SameSite=None; Secure` and must stay that way** (ADR
  0022). The API and the website are separate Workers and `workers.dev` is a
  public suffix, so they are different _sites_: a `Lax` cookie is silently never
  sent, and every request after a successful sign-in is anonymous. Only a shared
  registrable domain makes `Lax` correct again.
- **The API is closed, not just the UI.** Handlers take the owner id from
  `CurrentUser`, never from a payload. Every query filters by `userId`, and
  another user's row surfaces as `TodoNotFound`, never a 403 — a 403 confirms the
  row exists.
- **Regenerating auth tables is a manual procedure.** Follow
  `docs/technical/architecture.md#regenerating-the-auth-tables`; the CLI cannot
  import the driver, so it runs against a throwaway
  `drizzleAdapter({} as never, { provider: "sqlite" })` config.

## Object storage

**Generated avatars and every other user-facing asset live in one R2 bucket under
`public/*`, and the URL is stored on the row** (ADR 0021).

- **The bucket is private; the API Worker's `GET /public/*` is the read path.**
  R2 serves anonymous reads only through a custom domain, and this stack owns no
  zone. The route's key pattern is a trust boundary — widen it and `private/*`
  becomes readable.
- **Write through the binding.** `Cloudflare.R2.ReadWriteBucket`, and its `raw`
  escape hatch for the non-Effect code inside Better Auth's hooks. Never add an
  AWS SDK, never add Bun's `S3Client` back, never add a second bucket — a new
  kind of asset is a new prefix.
- **There are no S3 credentials.** No identity file, no init container, no
  `S3_*` variables.

## Vendored repositories

`repos/` holds pinned third-party source fetched by `./scripts/vendor.sh`, which
documents its own usage and is the only place versions are listed (ADR 0012).

- **`repos/` is gitignored. Never commit it.** Missing on a fresh clone is
  expected — run the script.
- **Never import from `repos/`.** Application code imports normal dependencies.
- **Do not edit anything under `repos/`** unless explicitly asked.
- Prefer patterns from vendored source over generated guesses or web search.
- **`effect-machine` is a deliberate non-adoption.** Read it as reference; never
  propose, install or import it.
- **`alchemy` is a dependency on this branch** (ADR 0019), so `repos/alchemy` is
  its API source of truth at the exact installed version — the same relationship
  `repos/effect` has. Read it before guessing an alchemy API. `effect-query` is
  likewise a real dependency, of `apps/web`.
