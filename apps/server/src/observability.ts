// Imported by subpath, not from the package root: the barrel re-exports `WebSdk`,
// which imports `@opentelemetry/sdk-trace-web` — an optional peer this server does
// not install, so the root import fails at runtime (ADR 0015).
import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect, Layer, Logger, Option, References } from "effect";
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
      // span processor, so spans are created and discarded rather than sent.
      onNone: () => NodeSdk.layerEmpty,
      onSome: (endpoint) =>
        NodeSdk.layer(() => ({
          resource: { serviceName: config.serviceName },
          // Batched, not simple: a span export per request would put an HTTP
          // round-trip on the hot path of every request it is measuring.
          spanProcessor: new BatchSpanProcessor(
            new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          ),
        })),
    });

    return Layer.mergeAll(
      Logger.layer([config.logFormat === "json" ? Logger.consoleJson : Logger.consolePretty()]),
      Layer.succeed(References.MinimumLogLevel, config.logLevel),
      // Merged after, not alongside: `Layer.mergeAll` builds in parallel, so the
      // SDK's own `Resource` dependency would go unsatisfied inside it.
    ).pipe(Layer.provideMerge(tracing));
  }),
);
