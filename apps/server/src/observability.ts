import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import { Effect } from "effect";

/**
 * Where the telemetry goes (ADR 0023).
 *
 * Effect already emits all three signals — `Effect.fn` spans, `Effect.log*`
 * records, `Metric` updates (ADR 0015) — and on a Worker the exporter is a
 * binding layer rather than an SDK: `Axiom.Telemetry` in `worker.ts` binds these
 * datasets' OTLP endpoints and the ingest token onto the Worker, and the runtime
 * flushes each event's buffer through `ctx.waitUntil` after the response is sent.
 *
 * Infrastructure, not a feature slice — there is no `features/observability/`.
 */

/**
 * Datasets are named per stage, and that is not cosmetic: a `Dataset` is a
 * resource in *this* stage's state, so two stages pointing at one Axiom dataset
 * means `alchemy destroy` on a dev stage deletes production's events. One set per
 * stage keeps destroy local. The cost is that a cross-stage query is a union.
 */
const datasetName = (stage: string, signal: "traces" | "logs" | "metrics"): string =>
  `xsblx-${stage}-${signal}`;

/**
 * One dataset per signal, because `kind` fixes both the schema and how Axiom
 * renders it — and it is replacement-forcing, so a change deletes the events.
 * `retentionDays` is not: it updates in place, which makes retention a
 * reviewable diff and nothing more.
 */
export const Traces = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  return yield* Axiom.Dataset("Traces", {
    name: datasetName(stage, "traces"),
    kind: "otel:traces:v1",
    description: "Effect spans from the xsblx API Worker",
    retentionDays: 30,
    useRetentionPeriod: true,
  });
});

export const Logs = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  return yield* Axiom.Dataset("Logs", {
    name: datasetName(stage, "logs"),
    kind: "otel:logs:v1",
    description: "Effect log records from the xsblx API Worker",
    retentionDays: 30,
    useRetentionPeriod: true,
  });
});

export const Metrics = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  return yield* Axiom.Dataset("Metrics", {
    name: datasetName(stage, "metrics"),
    kind: "otel:metrics:v1",
    description: "Effect runtime and domain metrics from the xsblx API Worker",
    // Metrics would be worth keeping longer than the traces they came with —
    // they are cheap, and they are the only way to answer a question about last
    // quarter. The number is the plan's ceiling, not a judgement: Axiom rejects
    // any dataset whose retention exceeds the account's window
    // (`retention period cannot exceed the data retention window of the current
    // plan`), so raising it here means raising the plan first.
    retentionDays: 30,
    useRetentionPeriod: true,
  });
});

/**
 * A token that can do exactly one thing: create events in this stage's three
 * datasets. It cannot query, cannot list, and cannot reach a dataset that is not
 * named here — which is what makes it safe to bind onto a Worker.
 *
 * Axiom returns the bearer once, at create time, and has no update API: any prop
 * change replaces the token and mints a new one, and identical props never
 * rotate it. The value is persisted in resource state, so the state store is as
 * sensitive as the token.
 */
export const Ingest = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  return yield* Axiom.ApiToken("Ingest", {
    name: `xsblx-ingest-${stage}`,
    description: "OTLP ingest for the xsblx API Worker",
    datasetCapabilities: {
      [datasetName(stage, "traces")]: { ingest: ["create"] },
      [datasetName(stage, "logs")]: { ingest: ["create"] },
      [datasetName(stage, "metrics")]: { ingest: ["create"] },
    },
  });
});
