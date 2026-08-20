---
status: accepted
version: 1.0.0
updated: 2026-08-20
---

# 0023 — Axiom is the telemetry sink, wired as a binding layer

## Context

ADR 0019 moved the deploy to Cloudflare and deleted `observability.ts`: the
exporter it held was a Node OpenTelemetry SDK, which does not run on workerd. The
instrumentation survived — `Effect.fn` spans, `Effect.log*`, `Metric` (ADR 0015) —
and went nowhere. That ADR deferred the choice of sink and said it needed one of
its own. This is it.

Three candidates, from that deferral:

- **Analytics Engine.** Cloudflare-native and nearly free, but a metrics sink.
  Spans have nowhere to land, which deletes the thing ADR 0015 was protecting: a
  service method's latency and its call tree.
- **OTLP over `fetch` to a collector we run.** Keeps the model and the vendor
  neutrality, and costs a collector to operate — on a VPS, which is the
  dependency this branch exists to remove.
- **Axiom.** An OTLP endpoint per signal, and — the part that matters here —
  alchemy models the receiving end as resources: `Axiom.Dataset`,
  `Axiom.ApiToken`, and an `Axiom.Telemetry` binding layer that wires the
  endpoints and the ingest token onto the Worker.

A fourth shape exists and is not the same thing: a Workers
`ObservabilityDestination` pushes Cloudflare's _own_ Workers Logs to an OTLP
endpoint. That exports what Cloudflare sees — request lines, `console` output —
not what Effect emits, and it stores the ingest token in Cloudflare's
account-level config.

## Decision

**Telemetry ships to Axiom, and both ends are declared in the stack.**

- **`apps/server/src/observability.ts` holds the receiving end**: three datasets
  (`otel:traces:v1`, `otel:logs:v1`, `otel:metrics:v1`) and one ingest-only
  `ApiToken` scoped to exactly those three. It is infrastructure, not a feature
  slice — the file is back, with a different job.
- **Retention is 30 days on all three, because that is the plan's ceiling.**
  Axiom rejects a dataset whose `retentionDays` exceeds the account's window, so
  the number tracks the plan rather than the signal's usefulness — metrics would
  otherwise be worth keeping longer than the traces beside them.
- **The exporter is a binding layer, not an SDK.** `Axiom.Telemetry({ token,
traces, logs, metrics, serviceName })` goes into the Worker's single
  `Effect.provide`. Building it binds each dataset's OTLP endpoint as a plain
  var and the token's `Authorization` header as a secret; at runtime the
  built-in exporter ships each signal and the flush is registered with
  `ctx.waitUntil`, so it lands after the response and adds no latency.
- **Datasets are named per stage** (`xsblx-<stage>-traces`, …). A `Dataset` is a
  resource in that stage's state, so a shared name means `alchemy destroy` on a
  dev stage deletes production's events. Per-stage names keep destroy local; the
  `alchemy.stage` attribute every signal already carries is then a filter, not
  the only thing separating stages.
- **`serviceName` is pinned to `xsblx-api`.** The default is the Worker's
  generated physical name, which carries the stage and changes with it — useless
  as a service identity.
- **The ingest token can only ingest.** `datasetCapabilities` grants
  `ingest: ["create"]` on the three datasets and nothing else: no query, no list,
  no other dataset. It is the only credential the Worker carries besides
  `AUTH_SECRET`.
- **Credentials for _deploying_ Axiom resources are alchemy's, not ours.**
  `alchemy login` picks up `AXIOM_TOKEN` (or a stored token), the same way it
  handles Cloudflare. There is no `AXIOM_*` variable in application config.
- **This amends ADR 0015 and ADR 0019.** ADR 0015's rules are unchanged and now
  have an effect again — a method without `Effect.fn` is invisible in a trace, a
  `console.log` bypasses the exporter, a metric earns its place only when a trace
  cannot answer the question. ADR 0019's "nothing is exported" consequence is
  what this replaces.

## Consequences

- **The instrumentation is no longer free.** Every span, log record and metric
  update is now serialised and POSTed once per event. It happens in
  `ctx.waitUntil` so the response is not delayed, but it is CPU time on the
  Worker's budget and a subrequest per signal per event. If that ever bites, the
  lever is sampling at the tracer, not deleting spans.
- **The bearer token lives in resource state.** Axiom returns it once, at create
  time, and has no update API — so alchemy persists it, and the state store
  (`Cloudflare.state()`, ADR 0019) is as sensitive as the token itself. Rotating
  it means changing a prop, which replaces the token.
- **Destroying a stage destroys its telemetry.** That is the point of per-stage
  datasets, and it also means a `test` stage's e2e run leaves nothing behind —
  including the trace of the failure you wanted to read. Deploy with
  `NO_DESTROY=1` to keep it.
- **The website Worker exports nothing.** `Cloudflare.Website.Vite` builds a
  Worker from Vite output and has no init Effect to provide a layer to, so SSR
  and server routes are invisible here. Cloudflare's own Workers Logs cover
  them, and an `ObservabilityDestination` is the escape hatch if that stops
  being enough.
- **There is no log-level knob.** Effect's default minimum level (`Info`) applies
  and `LOG_LEVEL` is gone with `observability.ts`'s old config. Turning debug
  logging on in a deployed stage is a code change today; the fix, when it is
  wanted, is one `Config` read in the Worker's init — which alchemy then binds as
  a var.
- **Nothing alerts.** Datasets and a token are ingest; `Axiom.Monitor` +
  `Axiom.Notifier` are the alerting half and both are resources this stack does
  not declare, because a notifier needs a destination (a Slack webhook, an email)
  that is a decision about who gets paged. Telemetry nobody watches is a storage
  bill — the first monitor belongs in the same file as the datasets.
- **Axiom is a third party in the request path's tail.** An export failure is
  logged and skipped rather than failing the request, and the plan's ingest and
  retention limits are the ceilings to watch first.
- **Deploying these resources needs a create-capable Axiom credential, which is
  not the same token the Worker carries.** An ingest-scoped API token (`xaat-…`)
  cannot declare datasets — `Forbidden: … resource: datasets with action:
create`. A personal access token (`xapt-…`) can, but is not org-scoped, so it
  also needs `AXIOM_ORG_ID` or every call fails with `'X-AXIOM-ORG-ID' header
must be set`. Both facts are in `.env.example`.
