---
status: accepted
version: 1.1.0
updated: 2026-08-20
amended-by: ./0024-custom-domains-make-the-session-cookie-first-party.md
---

# 0022 — Better Auth becomes a service, over the app's own D1 database

## Context

ADR 0007 put Better Auth outside the Effect runtime: a module-level `auth`
singleton, built at import time from `process.env`, owning its own drizzle
connection. On Bun that works — the environment and the database exist before the
first request.

On a Worker neither does. Bindings are resolved per event, `process.env` is not
the source of configuration, and a module-level `betterAuth(...)` would run at
plan time, at build time and in every isolate with nothing to connect to.

alchemy ships `@alchemy.run/better-auth`, which is two things:

- **`BetterAuth`**, a `Context.Service` whose shape is exactly what is needed —
  an `auth` accessor plus a `fetch` `HttpEffect` that hands the library's web
  `Response` back to the router.
- **`CloudflareD1`**, a layer that implements it — but by declaring
  `Cloudflare.D1.Database("BetterAuth")`, a database of its own.

A second database would put `user` in one D1 and `todos` in another. SQLite has no
cross-database foreign key, so `todos.user_id` would reference nothing, and the
auth tables would need a migration path separate from `Drizzle.Schema`.

## Decision

**Better Auth is provided as alchemy's `BetterAuth` service, by a layer of ours
over the app's own D1 database and R2 bucket.**

- **The tag is alchemy's, the layer is ours.** `layerBetterAuth` in
  `features/auth/auth.ts` builds the instance inside an `Effect.cached` — once
  per isolate, on the first request that needs it, never at plan or deploy time —
  from `options.database.raw`, `options.assets.raw` and the Worker's own URL.
  `CloudflareD1` is deliberately unused, for the reason above.
- **The adapter is `drizzleAdapter(drizzle(d1), { provider: "sqlite", schema })`.**
  Better Auth is a plain library, so it gets the promise driver
  (`drizzle-orm/d1`) over the raw binding rather than the Effect one the domain
  services use. Same database, same tables, same migrations.
- **`AUTH_SECRET` is `Config.redacted`, resolved in the Worker's init phase.**
  That is what makes alchemy bind it as a secret on the deployed Worker (ADR
  0019); reading it inside the handler instead would leave it unbound.
- **The response passes through `HttpServerResponse.fromWeb`.** It splits
  `set-cookie` with `getSetCookie()` before rebuilding the cookies, which is the
  header-flattening bug ADR 0007 exists to prevent, avoided a different way.
- **The session middleware erases `RuntimeContext` with
  `RuntimeContext.phantom`.** The lazily-resolved binding puts alchemy's runtime
  context in the requirements, and `HttpApiMiddleware` admits nothing beyond what
  it provides. The phantom is `Layer.empty` with a type: it erases the
  requirement, shadows nothing, and the Worker bridge's real runtime context is
  still the one in scope when the handler runs.
- **This amends ADR 0007.** Everything else there holds: auth routes are not in
  `packages/api`, credential rules live once in
  `packages/api/src/features/auth/credentials.ts`, handlers take the owner from
  `CurrentUser`, and another user's row is `TodoNotFound` and never a 403.

## Consequences

- **`auth` is no longer importable.** Anything that needs it takes the
  `BetterAuth` service, which means it runs inside a request. There is no
  module-level instance to reach for in a script.
- **One `Effect.provide` lives outside an entry point.** The phantom in
  `middleware.ts` trips `strictEffectProvide`, so that file has a scoped
  `overrides` entry in `tsconfig.effect.json` — never a repo-wide downgrade, per
  the standing rule. The justification is in the override's comment.
- **The peer range is not satisfied on paper.** `@alchemy.run/better-auth`
  declares `better-auth@^1.6.2`; this repo is pinned to `1.7.0-rc.4`, and a
  prerelease does not satisfy a caret range, so `bun install` warns. Only the
  `BetterAuth` tag is used from that package — no code path from it constructs
  Better Auth — so the mismatch is a warning and not a risk. Bumping
  `better-auth` out of prerelease clears it.
- **Regenerating the auth tables changes dialect, not procedure.** The CLI still
  cannot import our driver, so the throwaway config now says
  `drizzleAdapter({} as never, { provider: "sqlite" })` and the generated tables
  are hand-merged into `features/auth/schema.ts` as `sqliteTable`s. The
  next `alchemy deploy` generates and applies the migration (ADR 0020).
- **Auth timestamps are integers.** `user.created_at` and friends are
  `integer({ mode: "timestamp_ms" })` with `$defaultFn`/`$onUpdate` on the JS
  side, because SQLite's `unixepoch()` is seconds and Better Auth writes `Date`s.
- **The session cookie is `SameSite=None; Secure`, which ADR 0008's two origins
  did not previously require.** On `main` the two origins were
  `localhost:3000` and `localhost:3001` — different origins, same site, so a
  `Lax` cookie travelled. Two Workers on `workers.dev` are different _sites_
  (it is a public suffix), and a `Lax` cookie is dropped on cross-site requests
  with no error: sign-in returns 200, sets the cookie, and every later call is
  anonymous. `advanced.defaultCookieAttributes` fixes it, at the cost of the
  cookie being third-party — which Safari's ITP blocks and Firefox partitions by
  default. A shared registrable domain (`api.example.com` + `app.example.com`)
  is the only real fix and would also delete the per-stage CORS list; it needs a
  zone, so it is not this branch's decision yet.
- **Auth routes still produce no spans**, and still charge per-request CPU to
  every authenticated route — the ceiling ADR 0007 recorded is unchanged by the
  runtime move, only harder to measure without an exporter (ADR 0019).
