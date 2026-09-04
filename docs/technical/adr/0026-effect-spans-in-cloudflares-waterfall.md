---
status: accepted
version: 1.0.0
updated: 2026-09-04
amends:
  - ./0025-cloudflare-native-observability.md
---

# 0026 — Effect's spans go back into Cloudflare's waterfall

## Context

ADR 0025 traded Effect's span tree for a boolean, and named the exact reason it
had to: Cloudflare's custom span API determines parentage from **async context**,
while Effect's `Tracer` passes `parent: Option<AnySpan>` explicitly and moves it
across fibers. `Tracer.context` could not restore an ambient context Cloudflare
would not hand out, so nested `Effect.fn` spans would flatten under the handler
span. 0025 called that "worse than not exporting them, because the trace would
look complete and be wrong", and left `Effect.fn` names in place as the cheap
half of a future reversal.

That future arrived from alchemy rather than from Cloudflare.
[alchemy#1444](https://github.com/alchemy-run/alchemy/pull/1444) adds
`Cloudflare.Telemetry()`, and its tracer solves the problem 0025 declared
unsolvable at that version. The mechanism is worth stating, because "a bridge
exists now" is not the finding — _this_ bridge being faithful is:

- Every Effect span, at creation, stores the `AsyncLocalStorage.snapshot()`
  taken **inside** Cloudflare's `startActiveSpan` callback. The ambient context
  Cloudflare would not expose is captured rather than read back.
- A child span resolves its parent context by walking up Effect's own
  `parent` chain to the nearest span that holds a snapshot, then _re-enters_ it
  to open the Cloudflare span. Explicit Effect parentage drives the async
  context, instead of competing with it.
- `Tracer.context` re-enters the current fiber's span context around evaluation,
  so a fiber resumed on a later tick — the case that flattens a naive bridge —
  still opens its subrequests under the right parent.
- `isTraced` on the created span cascades into Effect's `sampled` flag, so an
  untraced invocation skips `startActiveSpan` for the whole subtree rather than
  paying for spans nobody records.

The remaining gaps are narrow and stated rather than discovered later: only
scalar attributes cross over (`string`, `number`, `boolean`); span events, links
and non-scalar annotations stay Effect-local; and Cloudflare has no outcome
setter, so completion is recorded as an `effect.exit` attribute of `success`,
`failure` or `interrupted`. Effect's own trace and span ids stay independent of
Cloudflare's opaque ones.

The cost is a **compatibility date floor**. `tracing.startActiveSpan` exists from
`2026-07-28`, and alchemy's default is `2026-03-10`. The layer fails the deploy
rather than dropping spans quietly.

## Decision

**The API Worker provides `Cloudflare.Telemetry({ headSamplingRate: 1 })`, and
0025's clause against bridging `tracing.startActiveSpan` is withdrawn.**

Everything else in ADR 0025 stands: Cloudflare is the only sink, there is no
exporter and no ingest token, logs are `Logger.consoleStructured`, and
`propagationPolicy` stays at its default.

- **`Cloudflare.Telemetry()` joins the API Worker's single `Effect.provide`**,
  alongside the D1 and R2 binding layers. It provides `Tracer.Tracer`; nothing
  else in the layer stack changes.
- **The Worker pins `compatibility: { date: "2026-08-25" }`.** Above the
  `2026-07-28` floor, and above `2026-08-04`, from which `nodejs_compat` is on by
  default — the tracer imports `node:async_hooks`. Without the pin the deploy
  fails with `CloudflareTelemetryCompatibilityError`, naming the date.
- **`traces` leaves the `observability` literal in `apps/server/src/config.ts`.**
  The layer binds `observability.traces` on the host Worker itself, and
  `headSamplingRate` moves onto the layer's props. The literal keeps `enabled`
  and the `logs` block, and both Workers still share it.
- **The website Worker does not get the layer.** It is not an Effect Worker —
  `Website.Vite` has no init Effect and there is no Effect runtime in the SSR
  bundle to install a `Tracer` into. It keeps the `observability` prop, including
  its own `traces`, exactly as ADR 0025 left it. Its compatibility date is not
  bumped: a date is a runtime-semantics change, and it buys nothing here.
- **`Effect.fn("Feature.method")` is load-bearing again.** ADR 0025 demoted it to
  forward-compatible and kept it for precisely this. The names are now what the
  waterfall reads.
- **`Metric` stays dead.** The layer provides a `Tracer` and nothing else, so a
  counter still has no reader. ADR 0025's rule is unchanged.
- **`alchemy` is pinned to the merge commit**, not a release: PR 1444 landed
  after `2.0.0-beta.76` and there is no tag containing it. See ADR 0027.

## Consequences

- **The trace is deep again, and stays wide.** `fetch → Todos.list → D1 query`,
  with the platform's own auto-instrumentation still covering the website Worker
  and `/api/auth/*`. ADR 0025's "the one worth revisiting first" is settled; what
  0025 gained is not given back.
- **`Effect.fn` spans stop being built and discarded.** ADR 0015 flagged the
  wasted CPU and 0025 accepted it. It is now work with a reader.
- **An untraced invocation costs less than it did under 0025.** `isTraced`
  cascading into `sampled` skips the subtree, where 0025 built every span
  regardless.
- **The compatibility date is now load-bearing and shared with the tracer.**
  Lowering it below `2026-07-28` breaks the deploy loudly; the failure names the
  minimum. Raising it is an ordinary runtime-semantics change.
- **A dependency on an unreleased commit.** Until an alchemy release contains
  PR 1444, `bun install` reaches pkg.ing rather than the npm registry. ADR 0027
  owns that risk and the exit.
- **Attribute fidelity is partial, deliberately.** A non-scalar
  `Effect.annotateCurrentSpan` value is visible in Effect's own span and absent
  from Cloudflare's. Annotate with scalars when the value matters in the
  dashboard.
- **Reversing this is one line.** Drop `Cloudflare.Telemetry()` from the
  `Effect.provide` and put `traces` back on the `observability` literal; ADR 0025
  is then in force unamended. The compatibility date can stay.
