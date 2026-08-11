---
status: accepted
version: 1.1.0
updated: 2026-08-11
---

# 0015 — Effect-native observability, exported over OTLP

## Context

The server was already instrumented and exported nothing. Every method of
`features/todos/service.ts` is wrapped in `Effect.fn("Todos.list")` and friends,
which opens a span per call, and `getById` annotates its span with the requested
id. `HttpApi` opens an `http.span` around each request. What was missing was the
other half: no logger configuration, no metrics, and no exporter, so every span
was built in memory and discarded on request completion.

The CORS allow-list already forwards `traceparent` and `b3` (ADR 0008), so the
browser's `HttpClient` propagates trace context to a server that discards it.
The gap was visible in the header configuration before it was visible in the
code.

That asymmetry is the whole reason to decide this now rather than later. The
instrumentation is the expensive half and it is already paid for; the exporter is
the cheap half. Leaving it unwired means the convention in `features/todos/`
looks decorative, and this project is scaffolding meant to be cloned — the
template is what every future feature is copied from.

Effect already provides all three signals natively: `Logger` for structured
logs, `Effect.withSpan` on top of a `Tracer`, and `Metric` for counters and
histograms. Nothing here needs a second library, and introducing one would mean
two competing context propagation mechanisms. The only missing piece is an
exporter that carries those signals out of the process.

The alternative considered was deferring observability until a real deployment
needs it. Rejected: the cost is not the exporter wiring, it is the
instrumentation convention, and that only stays cheap while there is one feature
to instrument.

## Decision

Observability uses Effect's own APIs, exported through
`@effect/opentelemetry` over OTLP.

`@effect/opentelemetry` joins the `effect` catalog at `4.0.0-beta.103`, the same
pin as every other Effect package (ADR 0002). It ships a build at that exact
version and requires `effect@^4.0.0-beta.103`.

Its `@opentelemetry/*` dependencies are peers — all optional except
`semantic-conventions` — so they install explicitly and at exact versions. The
server image resolves without `bun.lock` (ADR 0014), which makes a range unsafe
here. `sdk-logs` is a type-only import of `NodeSdk`, required for `typecheck`
even though no logs are exported:

| Package                                     | Version   |
| ------------------------------------------- | --------- |
| `@opentelemetry/api`                        | `1.9.1`   |
| `@opentelemetry/api-logs`                   | `0.221.0` |
| `@opentelemetry/sdk-logs`                   | `0.221.0` |
| `@opentelemetry/resources`                  | `2.10.0`  |
| `@opentelemetry/sdk-metrics`                | `2.10.0`  |
| `@opentelemetry/sdk-trace-base`             | `2.10.0`  |
| `@opentelemetry/sdk-trace-node`             | `2.10.0`  |
| `@opentelemetry/semantic-conventions`       | `1.43.0`  |
| `@opentelemetry/exporter-trace-otlp-http`   | `0.221.0` |
| `@opentelemetry/exporter-metrics-otlp-http` | `0.221.0` |

The OTel SDK versions two independent lines — `api` and the SDK packages on 1.x
and 2.x, the exporters and logs packages on 0.x — so these are picked by hand
against the peer ranges rather than moved together.

The logs OTLP exporter is not installed, because nothing imports it — logs reach
a collector as container stdout instead. It goes in if log export ever does.

`@opentelemetry/sdk-trace-web` is a declared peer and is deliberately not
installed — Bun implements the Node API surface, so the server takes
`sdk-trace-node`, and browser tracing in `apps/web` is a separate decision not
made here. The consequence is a runtime one, not a warning: importing from the
package root fails with `Cannot find module '@opentelemetry/sdk-trace-web'`,
because the barrel re-exports `WebSdk`. Server code imports
`@effect/opentelemetry/NodeSdk` by subpath.

One endpoint carries both signals, comes from config and defaults to unset. With
no endpoint neither the span processor nor the metric reader is installed, and
the process runs with no backend and no network calls — cloning this repo into a
real project means setting one environment variable.

The local backend is `grafana/otel-lgtm` in a compose profile, per ADR 0014's
rule that a new service is a profile and not a second compose file. One
container, one OTLP endpoint, all three signals. Jaeger was the first choice and
was wrong: it is traces-only and answers `404 page not found` on `/v1/metrics`.
The OTel SDK swallows that failure — exporter errors go to `diag`, which is off
by default, so a misdirected metric pipeline looks exactly like a working one.

Observability is infrastructure, not a feature slice. The layer is built in
`apps/server/src/observability.ts` — a sibling of `config.ts` and `migrate.ts` —
its configuration lives in `apps/server/src/config.ts`, and it is provided once,
beneath the server layer in `index.ts`, so everything below it logs and traces
through it. There is no `features/observability/` directory: a slice whose only
job is to forward a layer is the shallow abstraction `AGENTS.md` forbids.

`Layer.mergeAll` builds its members in parallel, so the SDK layer cannot sit
inside it — its own `Resource` dependency would go unsatisfied. It is applied
with `Layer.provideMerge` after the merge instead. `@effect/tsgo` catches this as
`TS377035`.

The three signals carry different weight:

- **Logs.** `Logger.consoleJson` when `LOG_FORMAT=json`, `Logger.consolePretty()`
  otherwise, defaulting by `NODE_ENV`; the threshold is `References.MinimumLogLevel`
  from `LOG_LEVEL`. `Effect.log*` calls already carry span context and
  annotations, so no per-call-site change is needed. The container collects stdout.
- **Traces.** Exported over OTLP/HTTP to `${endpoint}/v1/traces` through a
  `BatchSpanProcessor` — batched rather than simple, so span export is not an
  HTTP round-trip on the hot path of the request it measures. The spans
  themselves already exist: `Effect.fn("Todos.list")` in the service, `http.span`
  from `HttpApi`, so a trace runs request → service without further wiring.
- **Metrics.** Pushed to `${endpoint}/v1/metrics` by a
  `PeriodicExportingMetricReader` on its own 60s default interval, alongside
  `Metric.enableRuntimeMetricsLayer` for Effect's fiber gauges. Both are enabled
  only when an endpoint is configured — collecting with nothing to export to is
  pure overhead. Effect's HTTP server emits **no** request metrics of its own;
  `HttpMiddleware` has no metrics member, so request rate and latency come from
  span data, not from a counter. Domain counters are added where a specific
  question needs answering — `todos_created_total` in `features/todos/service.ts`
  is the one exemplar, and the pattern a copied feature follows.

## Consequences

- Ten new exact-pinned `@opentelemetry/*` dependencies in `apps/server`. Every
  one is a manual bump, and the two OTel version lines move independently — a
  bump means re-checking the peer ranges of `@effect/opentelemetry`, not matching
  version numbers across the table.
- `@effect/opentelemetry` is pinned by the `effect` catalog, so it is covered by
  ADR 0002's rule: never bump it alone. It moves when `effect` moves.
- Importing `@effect/opentelemetry` from its root breaks the server at runtime,
  not at typecheck. Anything added here imports by subpath.
- The server image grows. The runtime install already prunes devDependencies
  (ADR 0014); these are production dependencies and ship.
- Instrumenting service methods is now load-bearing rather than decorative. A
  feature copied from `features/todos/` that drops the `Effect.fn` span names is
  incomplete, the same way one without tests is.
- With no endpoint set, spans are still built on every request and thrown away.
  That cost is paid whether or not anything is exporting.
- Metrics resolve at 60s and the reader takes no environment variable, so a
  faster interval is a code change. Shutdown force-flushes, so a short-lived
  process still reports.
- Every worker exports its own metrics, so a query without `sum()` reads one
  process. `service.instance.id` carries the pid to keep the series apart;
  dropping it makes four workers silently report one worker's counts. Traces are
  unaffected — spans are independent.
- Reversing the export is cheap — delete `observability.ts`, its line in
  `index.ts`, the config entries and eleven dependencies. Reversing the
  instrumentation is not: the `Effect.fn` span names are spread across every
  service by design.
- Traces stop at the process boundary in one place: Better Auth runs outside the
  Effect runtime (ADR 0007), so auth routes produce no spans. Requests to
  `/api/auth/*` are invisible to tracing until that changes.
