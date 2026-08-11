// Imported by subpath, not from the package root: the barrel re-exports `WebSdk`,
// which imports `@opentelemetry/sdk-trace-web` — an optional peer this server does
// not install, so the root import fails at runtime (ADR 0015).
import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect, Layer, Logger, Metric, Option, References } from "effect";
import { ObservabilityConfig } from "./config.ts";

/**
 * Logs, traces and metrics all come from Effect itself — `Effect.log*`,
 * `Effect.fn`/`Effect.withSpan` and `Metric` — so this module only decides where
 * those signals go. Service code never imports it (ADR 0015).
 *
 * This is infrastructure, not a feature slice: it sits beside `config.ts` rather
 * than under `features/`, and is provided once in `index.ts`.
 */
export const ObservabilityLive = Layer.unwrap(
  Effect.map(ObservabilityConfig, (config) => {
    const tracing = Option.match(config.otlpEndpoint, {
      // No endpoint configured: `layerEmpty` installs the resource without any
      // span processor or metric reader, so both signals are produced and
      // discarded rather than sent.
      onNone: () => NodeSdk.layerEmpty,
      onSome: (endpoint) =>
        NodeSdk.layer(() => ({
          resource: { serviceName: config.serviceName },
          // Batched, not simple: a span export per request would put an HTTP
          // round-trip on the hot path of every request it is measuring.
          spanProcessor: new BatchSpanProcessor(
            new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          ),
          // Metrics are pushed on a timer, not scraped. The reader's own 60s
          // default is the export resolution; it takes no env var, so a faster
          // one means passing `exportIntervalMillis` here.
          metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
          }),
        })).pipe(
          // Fiber counts, and the other runtime gauges Effect keeps internally.
          // Only enabled alongside a reader — collecting them with nothing to
          // export to is pure overhead.
          Layer.provideMerge(Metric.enableRuntimeMetricsLayer),
        ),
    });

    return Layer.mergeAll(
      Logger.layer([config.logFormat === "json" ? Logger.consoleJson : Logger.consolePretty()]),
      Layer.succeed(References.MinimumLogLevel, config.logLevel),
      // Merged after, not alongside: `Layer.mergeAll` builds in parallel, so the
      // SDK's own `Resource` dependency would go unsatisfied inside it.
    ).pipe(Layer.provideMerge(tracing));
  }),
);
