import { availableParallelism } from "node:os";
import { Config } from "effect";

export const ServerConfig = Config.all({
  port: Config.port("PORT").pipe(Config.withDefault(3000)),
  // Workers share one port through SO_REUSEPORT. Harmless with a single process.
  reusePort: Config.succeed(true),
});

/**
 * `Bun.serve` is single-threaded, so one process saturates one core while the
 * rest of the machine idles. Workers are whole processes sharing the port, and
 * forking has to happen before the Effect runtime starts — hence the raw env
 * read instead of a `Config`.
 *
 * The default is 1: `bun --hot` cannot reload forked children, and interleaved
 * logs from several processes make local debugging worse.
 *
 * `WORKERS=auto` uses every core, but more workers is not monotonically better —
 * they contend for the same cores as Postgres and the load generator. Measured on
 * a 10-core machine, 4 workers peaked at 12.0k req/s against 5.3k for a single
 * worker, while 6 fell to 11.0k and 10 to 6.8k. Prefer an explicit number and
 * measure it on the machine you deploy to; `auto` is a starting point, not a
 * tuned value.
 *
 * Note this only helps on Linux. Load balancing across the shared port comes from
 * SO_REUSEPORT, which round-robins on Linux but hands every connection to a
 * single socket on macOS/BSD — locally the extra workers sit idle at 0% CPU.
 */
export const workerCount = (): number => {
  const raw = process.env["WORKERS"]?.trim();
  if (raw === undefined || raw === "") return 1;
  if (raw === "auto") return availableParallelism();
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`WORKERS must be a positive integer or "auto", got: ${raw}`);
  }
  return parsed;
};

/**
 * Browsers block cross-origin mutations without these headers, and the web app
 * runs on a different port. Origins are configured, never wildcarded — a
 * wildcard would let any site call this API from a visitor's browser.
 */
export const CorsConfig = Config.all({
  allowedOrigins: Config.nonEmptyString("CORS_ALLOWED_ORIGINS").pipe(
    Config.withDefault("http://localhost:3001"),
    Config.map((origins) => origins.split(",").map((origin) => origin.trim())),
  ),
});

/**
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is optional on purpose: with no endpoint the
 * tracing layer exports nothing and the process runs with no backend and no
 * network calls. Cloning this repo into a real project means setting it (ADR 0015).
 */
export const ObservabilityConfig = Config.all({
  serviceName: Config.nonEmptyString("OTEL_SERVICE_NAME").pipe(Config.withDefault("xsblx-server")),
  otlpEndpoint: Config.nonEmptyString("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(Config.option),
  logLevel: Config.schema(Config.LogLevel, "LOG_LEVEL").pipe(Config.withDefault("Info" as const)),
  // Structured logs are for a collector to parse; a human reading a dev terminal
  // wants the pretty renderer.
  logFormat: Config.nonEmptyString("LOG_FORMAT").pipe(
    Config.withDefault(process.env["NODE_ENV"] === "production" ? "json" : "pretty"),
  ),
});

export const DatabaseConfig = Config.all({
  url: Config.redacted("DATABASE_URL"),
});

export const S3Config = Config.all({
  endpoint: Config.nonEmptyString("S3_ENDPOINT"),
  accessKey: Config.redacted("S3_ACCESS_KEY"),
  secretKey: Config.redacted("S3_SECRET_KEY"),
  bucket: Config.nonEmptyString("S3_BUCKET"),
});
