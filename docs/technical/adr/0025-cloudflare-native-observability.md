---
status: accepted
version: 1.2.0
updated: 2026-09-04
amended-by:
  - ./0026-effect-spans-in-cloudflares-waterfall.md
supersedes:
  - ./0023-axiom-is-the-telemetry-sink.md
amends:
  - ./0015-effect-native-observability-over-otlp.md
---

# 0025 — Observability is Cloudflare-native, and Effect's spans stop being exported

## Context

ADR 0023 put the telemetry in Axiom: three datasets per stage
(`xsblx-<stage>-{traces,logs,metrics}`) plus an ingest-only token, exported by
`Axiom.Telemetry` over OTLP. It worked. It also had a ceiling nobody costed:
**datasets are per stage, so the count is `3 × stages`**, and Axiom's plan caps
datasets — the Personal plan at 3, higher plans at a soft limit. A stack whose
default stage is `dev_$USER` mints three more datasets per developer. The cap was
reached, and it is reached again by the next person who runs `alchemy deploy`.

The per-stage naming is not the bug. It is load-bearing for the reason ADR 0023
gave: a `Dataset` is a resource in _that_ stage's state, so a shared name means
`alchemy destroy` on a dev stage deletes production's events. Sharing datasets
across stages via `--adopt` is worse, not better — alchemy's adoption is a
_takeover_ (`AdoptPolicy`: `Unowned` + `adopt: true` → the adopting stage now
owns delete), so the hazard comes back with the ownership moved somewhere less
expected.

So the choice is not "name the datasets differently". It is whether the sink
should be a third party with a per-stage resource count at all.

Cloudflare's own observability closed most of the gap while ADR 0023 was in
force. Workers Logs and Workers Traces are now per-Worker features: a boolean in
the script's metadata, no named store, **no object to run out of**. A new stage
is a new Worker, and it costs nothing to observe. What ADR 0023 evaluated as
"Analytics Engine — a metrics sink, spans have nowhere to land" is no longer the
whole Cloudflare offering.

### What Cloudflare can and cannot take

Three things were checked against the runtime rather than assumed:

- **Logs — yes, natively.** `Logger.consoleStructured` writes the log record as
  an _object_ (`withConsoleLog` calls `console.log(self.log(options))`), and
  Workers Logs indexes a logged object's fields into queryable columns. A logged
  JSON _string_ is an opaque message instead, which is why `Logger.consoleJson`
  is the wrong one of the pair here.
- **Platform traces — yes, natively, and wider than what we had.** Automatic
  tracing instruments the fetch handler, binding calls (D1, R2), subrequests and
  Durable Objects with no code. It covers the two blind spots ADR 0023 recorded
  as permanent: the **website Worker**, which has no init Effect to provide an
  exporter to, and **`/api/auth/*`**, which runs outside the Effect runtime
  (ADR 0007).
- **Effect's span tree — no.** This is the decisive finding. Cloudflare's custom
  span API (`tracing.enterSpan` / `startActiveSpan` from `cloudflare:workers`)
  determines parentage from async context, exposes no `spanContext()`, and
  offers no "run this callback with an already-created span active". Effect's
  `Tracer` passes `parent: Option<AnySpan>` explicitly and moves it across
  fibers, and `Tracer.context` cannot restore an ambient context Cloudflare will
  not hand out. A faithful bridge is not possible at this version — nested
  `Effect.fn` spans would flatten under the handler span, which is worse than
  not exporting them, because the trace would look complete and be wrong.

Retaining the Effect span tree therefore meant a store rather than a bridge:
Workers Analytics Engine, with a hand-written Effect `Tracer` writing each ended
span as one data point (Effect keeps its own ids and parenting, so the tree stays
exact; 3-month retention, currently unbilled). That option was considered and
**rejected** — it trades a vendor we do not maintain for roughly 150 lines of
tracer and metric-flush code that we do, plus two more resources and a query path
with no UI. The pattern it protects is one feature deep.

## Decision

**Observability is whatever Cloudflare gives us for a boolean, and nothing else.**

- **`apps/server/src/observability.ts` is deleted**, with the three
  `Axiom.Dataset` declarations and the `Axiom.ApiToken`. `Axiom.Telemetry` leaves
  the API Worker's `Effect.provide`, and `Axiom.providers()` leaves the stack's
  provider layer. No `AXIOM_*` in `.env.example`, no Axiom step in
  `alchemy login`. **The dataset ceiling is gone, not raised** — there is no
  per-stage telemetry resource left to count.
- **Both Workers declare `observability` on the props.** Logs and invocation logs
  on, traces on, `headSamplingRate: 1`. The website takes the same block:
  `Website.Vite`'s props are `Omit<WorkerProps, "vite" | "main" | "assets">`, so
  the prop is available there and the SSR Worker stops being dark.
- **`Logger.consoleStructured` replaces the OTLP log exporter**, provided in the
  router's layer stack. `Logger.layer` replaces the default logger set rather
  than merging, which is what we want: one indexed object per record, no second
  pretty copy. The rule in `AGENTS.md` is unchanged in substance — `Effect.log*`
  still, `console.log` never — but the reason is now field indexing rather than
  span attachment.
- **`propagationPolicy` stays at its default `"authenticated"`.** The setting
  exists (`"authenticated" | "accept"`) and `"accept"` would make Cloudflare
  adopt the browser's inbound `traceparent` as its own trace id. That is only
  worth having if something of ours also exports spans under that id, and after
  this ADR nothing does. Leaving it at the default keeps the trace id
  unforgeable by callers.
- **The CORS allow-list keeps `traceparent` and `b3`** (ADR 0008). Effect's
  `HttpClient` in the browser sends them whether or not anything consumes them,
  and dropping them from the allow-list fails the preflight silently. This rule
  survives the sink change untouched.
- **`Effect.fn` on service methods stays mandatory, and is demoted from
  load-bearing to forward-compatible.** The spans are still built per call and
  now go nowhere. Keeping the names costs nothing at the call site and is the
  entire cost of reversing this decision later; deleting them across every
  service is the expensive half ADR 0015 identified and it stays paid.
- **`Metric` is dead and its one exemplar goes.** `todos_created_total` had no
  reader after this change, and `AGENTS.md`'s "no dead code" rule applies to a
  counter nobody exports. A metric returns when there is a sink for it.

## Migrating a stage that was deployed before this

Deleting the declarations is not enough, and this is the one place where the
usual "delete the old path in the same change" rule cannot be obeyed in a single
commit. Every stage deployed under ADR 0023 carries four rows in its state —
`Traces`, `Logs`, `Metrics`, `Ingest` — and **alchemy can only destroy a row
whose provider is still registered.** Removing `Axiom.providers()` at the same
time as the resources does not leave the rows orphaned quietly; it makes the
whole program unrunnable:

```
MissingProviderError: No provider is registered for resource type
'Axiom.Dataset' (state row 'Metrics').
```

`alchemy state clear` is not the way out — it clears whole stacks or stages, so
it would orphan the D1 database, the R2 bucket and both Workers along with the
datasets.

So `Axiom.providers()` stays in the stack's provider layer while the resources
are gone from the program. That is the state alchemy needs to see in order to
delete them, and the plan then reads:

```
Plan: 2 to update, 4 to delete, 3 to noop
[Api] update      [Ingest] delete    [Assets] noop
[Website] update  [Logs] delete      [Database] noop
                  [Metrics] delete   [Schema] noop
                  [Traces] delete
```

Once **every** stage has been deployed once — each one holds its own rows, so a
colleague's `dev_$USER` stage and `prod` both need it — the import,
`Layer.provideMerge(Axiom.providers())` and the `AXIOM_TOKEN` that provider
resolves all come out in a follow-up commit. Until then the dependency is
retained for deletion only: nothing in the program declares an Axiom resource,
and a stage that never had one deploys the same either way.

**This is done, as of 2026-08-26.** Both stages in this state store —
`dev_sabilimaulana` and `prod` — were deployed and now list five rows apiece
(`Api`, `Assets`, `Database`, `Schema`, `Website`) and no Axiom row, so
`Axiom.providers()`, its import and the `AXIOM_TOKEN`/`AXIOM_ORG_ID` variables
are gone. The procedure above is kept because it is not finished for everyone:
**a state store that still holds a stage deployed before ADR 0025 needs it
again**, and the symptom is the `MissingProviderError` above rather than a
missing dataset. Check with `alchemy state resources --stack xsblx --stage
<name>` before assuming a stage is clean.

## Consequences

- **A trace stops at the platform boundary.** The depth is `fetch → D1 query`,
  with nothing in between: no per-service-method latency, no `Todos.list` under
  the request span. Answering "which method was slow" now means reading logs and
  timing by hand. This is the accepted cost, and it is the one worth revisiting
  first.
- **The trace got wider while it got shallower.** The website Worker, every
  `/api/auth/*` request, D1 statement timings and R2 operations are visible for
  the first time. What was lost was depth inside our own code; what was gained
  was every request path that was previously invisible.
- **Retention drops from 30 days to 3 (free) or 7 (Workers Paid).** An incident
  older than a week is no longer reconstructable from telemetry. Logpush to R2 is
  the escape hatch if that bites, and it is not declared here.
- **`Effect.fn` spans and `Metric` updates are built and discarded on every
  request.** ADR 0015 flagged this cost when there was no exporter, and it is
  back. It is CPU on the Worker's budget with no reader.
- **`Effect.log*` records carry no trace id of their own.** `formatStructured`
  emits `message`, `level`, `timestamp`, `cause`, `annotations`, `spans`
  (log spans, not tracer spans) and `fiberId`. Correlation is Cloudflare's:
  console output is attributed to the active platform span by the runtime, which
  works precisely because we are no longer trying to run a second trace context
  alongside it.
- **Instrumentation is free again.** No OTLP serialisation, no subrequest per
  signal, no `ctx.waitUntil` flush, no bearer token on the Worker. The only
  credential it now carries is `AUTH_SECRET`.
- **Nothing alerts, still.** Unchanged from ADR 0023, with a different vendor:
  Cloudflare Notifications is the un-declared half, and it needs the same
  undecided answer about who gets paged.
- **The export path is not closed.** `Cloudflare.Workers.ObservabilityDestination`
  models an OTLP destination, and `observability.{logs,traces}.destinations`
  takes its slug — so Cloudflare's own spans and logs can be pushed to a third
  party later, including Axiom, without any of this being undone. Note what that
  does and does not carry: it exports what Cloudflare sees, never what Effect
  emits. It is not a way back to ADR 0023.
- **Reversing this is the reverse of ADR 0023's reversal**, and cheap for the
  same reason: restore `observability.ts`, put `Axiom.Telemetry` back in the one
  `Effect.provide`. The instrumentation it needs is deliberately still in place.
