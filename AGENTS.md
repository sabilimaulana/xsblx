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
- **Two files stay central and are not feature-folded:**
  `apps/server/src/db/schema.ts` (barrel of every `features/*/schema.ts`) and
  `packages/api/src/api.ts` (composes the groups — its only job).
- **Schemas, the `HttpApi` definition and domain errors live in `packages/api`**
  (ADR 0001). Never import from `apps/server` into `apps/web`.
- **Services return domain errors only** (ADR 0003). Infrastructure failures are
  `Effect.orDie` — they are bugs, not outcomes. One wrapper error per domain.
- **Row types never escape the service.** `toDomain` converts at the boundary.
- **Handlers hold no business rules.** They map service error reasons onto the
  endpoint's declared errors; an unexpected reason is `Effect.die`.
- **Tests hit real Postgres** (ADR 0004), and live beside the code they test
  (`src/**/*.test.ts`). No `test/` directory, no hand-written in-memory fake.
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
- **The production build goes through Nitro** (ADR 0013): `bun run build` emits
  `.output/`, `bun run start` runs `.output/server/index.mjs`. Only that server
  serves `/assets/*` — checking a build means checking a stylesheet returns 200.
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
`ls node_modules/.bun | grep '^vite@'`. This is why
`apps/server/vitest.config.ts` uses `process.loadEnvFile`, not vite's `loadEnv`.

## Containers

**One `Dockerfile` (targets `server`, `web`) and one `compose.yaml`** (ADR 0014).
A second Dockerfile or a `compose.prod.yml` is a wrong turn — a new service goes
in a profile.

- **Bun is pinned to `1.3.14` in the image and in CI.** Bump both together.
- **The server's runtime install deletes `bun.lock`, the web/ui manifests and the
  devDependencies, and uses `--linker hoisted`.** Every part of that is
  load-bearing; read ADR 0014 before simplifying it back to `bun install`.
- **Migrations run through `apps/server/src/migrate.ts`**, never `drizzle-kit` —
  the image has no dev dependencies.
- **Adding a server dependency at an inexact version is not safe here**, because
  the image resolves without the lockfile. Pin it.

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
(ADR 0007). Read that ADR before touching auth. Rules that are load-bearing:

- **Auth routes are not in `packages/api`.** Better Auth owns that contract.
- **The raw route passes the web `Response` through untouched** — flattening its
  headers merges multiple `set-cookie` values into one broken cookie.
- **Credential rules live once**, in `packages/api/src/features/auth/credentials.ts`.
- **The API is closed, not just the UI.** Handlers take the owner id from
  `CurrentUser`, never from a payload. Every query filters by `userId`, and
  another user's row surfaces as `TodoNotFound`, never a 403 — a 403 confirms the
  row exists.
- **Regenerating auth tables is a manual procedure.** Follow
  `docs/technical/architecture.md#regenerating-the-auth-tables`; the CLI cannot
  import `drizzle-orm/bun-sql`.

## Vendored repositories

`repos/` holds pinned third-party source fetched by `./scripts/vendor.sh`, which
documents its own usage and is the only place versions are listed (ADR 0012).

- **`repos/` is gitignored. Never commit it.** Missing on a fresh clone is
  expected — run the script.
- **Never import from `repos/`.** Application code imports normal dependencies.
- **Do not edit anything under `repos/`** unless explicitly asked.
- Prefer patterns from vendored source over generated guesses or web search.
- **`alchemy` and `effect-machine` are deliberate non-adoptions.** Read them as
  reference; never propose, install or import them. `effect-query` is different —
  it is a real dependency of `apps/web`.
