---
status: accepted
version: 1.0.0
updated: 2026-08-20
amended-by: ./0023-axiom-is-the-telemetry-sink.md
---

# 0019 — Cloudflare is the deploy target, and alchemy is how it is described

## Context

`main` deploys to a VPS: one `Dockerfile`, one `compose.yaml`, Postgres and
SeaweedFS beside the apps, Nitro serving the web build (ADR 0013, ADR 0014). That
shape works and stays on `main`. This branch answers a different question — what
the same system looks like on Cloudflare — and the two cannot be one branch
without a compatibility layer per seam, which Engineering Priority 1 rules out.

Three ways to describe a Cloudflare deploy:

- **Wrangler.** A `wrangler.jsonc` per Worker, in a config language that knows
  nothing about the program it configures. Bindings are declared twice — once in
  JSON, once as `env.FOO` in code — and nothing type-checks the pair. Migrations
  and secrets become CI shell steps.
- **Terraform / Pulumi.** A second toolchain, a second state model and a second
  language to hold the same graph. Buys multi-cloud we do not have and costs a
  provider release cycle behind Cloudflare's API.
- **[alchemy](https://alchemy.run) v2.** Infrastructure as an Effect program:
  resources are Effects, a Worker's deploy definition and its request handler are
  the same value, and a binding is one `yield*` that wires the IAM/env/typed
  client in one place. It is Effect 4 native — its `effect` peer range is
  `>=4.0.0-beta.102`, so it runs on the version this repo is already pinned to
  (ADR 0002) and speaks the same `effect/unstable/http` API our handlers do.

ADR 0012 vendored alchemy as reference and recorded it as a **deliberate
non-adoption**. That call was made for a VPS deploy where alchemy had nothing to
describe. The premise changed; the conclusion has to.

## Decision

**This branch deploys to Cloudflare, and the whole deploy is one alchemy program
at the repo root.**

- **`alchemy.run.ts` is the stack.** One stack for the monorepo, not one per
  package: the website consumes the API's URL straight off an in-memory `Output`,
  so there is nothing to sequence by hand and no cross-stack reference to
  resolve. `alchemy deploy` puts both Workers up; `alchemy destroy` takes them
  down together.
- **Two Workers, and the API is public.** `apps/server` is a
  `Cloudflare.Worker` serving the shared `HttpApi` at its own URL;
  `apps/web` is a `Cloudflare.Website.Vite`. The browser calls the API directly
  with the session cookie, so the CORS allow-list and `credentials: true` stay
  load-bearing (ADR 0008) rather than being replaced by a service binding.
- **alchemy is pinned to `2.0.0-beta.70`, the tag `scripts/vendor.sh` vendors.**
  The dependency and the reference source are the same version, the way `effect`
  and `repos/effect` already are. Bump both together, never one.
- **State lives in `Cloudflare.state()`.** A teammate's or CI's plan diffs
  against the same recorded state this machine does. `.alchemy/` is gitignored
  for the local fallback the test harness uses.
- **Paths are absolute, anchored with `import.meta.url`.** `alchemy` runs from
  the workspace root, so a relative `main`, `rootDir`, `schema` or `out` declared
  inside `apps/*` resolves against the root and silently points at nothing.
- **This supersedes ADR 0013 and ADR 0014**, and supersedes the alchemy
  non-adoption clause of ADR 0012 — the rest of ADR 0012 (vendored sources are
  read-only, never imported; `effect-machine` stays a non-adoption) still stands.

## Consequences

- **There is no `Dockerfile` and no `compose.yaml` on this branch, and no local
  Postgres or SeaweedFS to start.** `bun run dev` is `alchemy dev`: Vite's dev
  server with HMR, and bindings pointing at the **real** cloud resources. There
  is no emulation-fidelity gap because there is no emulation, and there is also
  no offline path — development needs an authenticated Cloudflare account.
- **`HttpApi` on workerd needs two shims.** `HttpPlatform.layer` requires a
  `FileSystem`, which an isolate does not have, so `worker.ts` provides a stub
  whose file responses die and whose compression is the real
  `CompressionStream`-backed web implementation. And the init phase may only
  _construct_: `HttpApiBuilder.group` and `HttpRouter.toHttpEffect` are safe
  there, executing a request is not.
- **A resource declaration inside the Worker's bundle may not parse a URL.** The
  init phase runs at runtime as well as at plan time, and a bundled module's
  `import.meta.url` is not a file URL — `fileURLToPath(new URL(…, import.meta.url))`
  in `db/database.ts` threw `TypeError: Invalid URL string` inside workerd on
  _every_ request, before routing, so the whole API answered 500 while the deploy
  reported success. Plan-time-only props take plain strings relative to the
  workspace root, which is where `alchemy` runs from. `main: import.meta.url` is
  unaffected — it is read, never parsed.
- **`alchemy/Drizzle` must be imported by subpath.** The barrel eagerly loads its
  MySQL and Postgres drivers, whose optional peers are not installed, and the
  failure is a module-not-found at startup — the same trap
  `@effect/opentelemetry` has (ADR 0015). `alchemy/Drizzle/D1`,
  `alchemy/Drizzle/Schema`, `alchemy/Drizzle/Providers`.
- **`@effect/platform-bun` and `@effect/platform-node` are root devDependencies
  even though nothing imports them.** alchemy's Cloudflare bridge and CLI do, and
  a missing one is a module-not-found the moment the stack is loaded.
- **Observability is not wired on this branch.** ADR 0015's exporter layer is a
  Node OTel SDK, which does not run on workerd, so `observability.ts` is gone and
  nothing is exported. The rules it set still hold — service methods are
  `Effect.fn("Feature.method")`, logs go through `Effect.log*`, one metric per
  feature — so the signals exist and are dropped, exactly as they were with no
  `OTEL_EXPORTER_OTLP_ENDPOINT` set. Choosing a Workers-compatible sink (Axiom,
  Analytics Engine, an OTLP endpoint over `fetch`) is a decision this branch
  defers, and it needs its own ADR.
- **Secrets are whatever the deploy environment holds.** A `Config` value
  resolved in a Worker's init phase is bound onto the deployed Worker as a
  secret, so `AUTH_SECRET` and `CORS_ALLOWED_ORIGINS` come from the root `.env`
  (or CI's environment) and there is no second place to set them. A `Config`
  first read inside a handler is never discovered and never bound — that failure
  is a missing env var at runtime, not a deploy error.
- **The website's API origin is baked into the client bundle.** `VITE_API_URL` is
  inlined at build time from `api.url`, so the API Worker deploys first and
  changing its URL means rebuilding the site — which one `alchemy deploy` already
  does.
- **The reverse edge is deliberately absent.** The API's CORS allow-list is
  configuration, not `website.urls`, because taking both edges would make the two
  Workers a cycle in the deploy graph.
- **This branch and `main` diverge permanently.** Nothing here is meant to merge
  back: `main` is the VPS deploy, this is the Cloudflare one, and a shared
  ancestor is the only thing they have in common.
