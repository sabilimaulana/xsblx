import { Config, Effect, Option, Schema } from "effect";

/**
 * An origin exactly as a browser sends it — scheme, host, optional port; no
 * path, no trailing slash, no wildcard. CORS and yielded both compare origins
 * as strings, so `https://app.example.com/` would match nothing, and yielded
 * would fail the Worker at build. Validating here makes it a `ConfigError` at
 * deploy instead.
 */
const Origin = Schema.String.check(
  Schema.makeFilter((value) => {
    const url = URL.parse(value);
    return (
      (url !== null &&
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value) ||
      "must be an origin like https://app.example.com"
    );
  }),
);

const HttpsOrigin = Origin.check(
  Schema.makeFilter((value) => value.startsWith("https://") || "must be an https origin"),
);

const decodeConfig =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (value: S["Encoded"]) =>
    Schema.decodeEffect(schema)(value).pipe(
      Effect.mapError((issue) => new Config.ConfigError(issue)),
    );

/**
 * Browsers block cross-origin mutations without these headers, and the web app is
 * a different Worker on a different hostname. Origins are configured, never
 * wildcarded — a wildcard would let any site call this API from a visitor's
 * browser (ADR 0008).
 *
 * The value is read in the Worker's init phase, so alchemy binds it as a secret
 * on the deployed Worker and the same `CORS_ALLOWED_ORIGINS` drives dev and prod.
 * It is deliberately not the website's `url` output: the website already consumes
 * the API's URL, and taking the reverse edge as well would make the two Workers
 * a cycle in the deploy graph.
 */
export const CorsConfig = Config.all({
  allowedOrigins: Config.NonEmptyString("CORS_ALLOWED_ORIGINS").pipe(
    Config.withDefault("http://localhost:3001"),
    Config.mapEffect((origins) =>
      decodeConfig(Schema.Array(Origin))(origins.split(",").map((origin) => origin.trim())),
    ),
  ),
});

/**
 * The API Worker's own public origin, which yielded checks requests against
 * (ADR 0030). HTTPS only: the session cookie is `Secure`.
 */
export const ApiPublicOriginConfig = Config.NonEmptyString("API_PUBLIC_ORIGIN").pipe(
  Config.mapEffect(decodeConfig(HttpsOrigin)),
);

/**
 * The hostnames the two Workers answer on, when the stage has any (ADR 0024).
 *
 * Unset is the normal case, and means *unmanaged*: alchemy leaves custom domains
 * alone and the Worker keeps its generated `workers.dev` URL. Only a stage whose
 * env file names them — `prod`, via `.env.prod.local` — gets a hostname, because
 * the zone has one apex and a stage name is not always a legal hostname label
 * (`dev_sabilimaulana` has an underscore).
 *
 * Setting the API's domain also changes what the *website* is built against:
 * alchemy makes `https://<name>` the Worker's primary `url`, and that output is
 * what `VITE_API_URL` inlines.
 */
const domain = (name: string) =>
  Config.option(Config.NonEmptyString(name)).pipe(Config.map(Option.getOrUndefined));

export const ApiDomainConfig = domain("API_DOMAIN");

export const WebDomainConfig = domain("WEB_DOMAIN");

/**
 * What Cloudflare records about a Worker (ADR 0025, ADR 0026).
 *
 * A literal rather than a `Config`, because it is not per-stage: a stage that
 * wants less telemetry wants a lower sampling rate, and nothing here is worth a
 * variable until one does.
 *
 * The two Workers differ in exactly one place — who owns `traces` — so the part
 * they share is named once and each adds its own.
 */
const recordEverything = {
  enabled: true,
  // `invocationLogs` is the request line itself — method, status, duration —
  // which is what makes a log search answer "what happened" without a trace.
  logs: { enabled: true, invocationLogs: true },
} as const;

/**
 * The API Worker deliberately has **no `traces` block**.
 *
 * `Cloudflare.Telemetry()` in `worker.ts` binds one, and an explicit
 * `observability.traces` on the prop wins over a bound one and discards it —
 * silently, since traces are on either way and only the layer's sampling rate
 * would go missing. Sampling for this Worker lives on the layer's props
 * (ADR 0026).
 */
export const apiObservability = recordEverything;

/**
 * The website Worker keeps the whole block, sampling rate included.
 *
 * It is not an Effect Worker — `Website.Vite` has no init Effect and no Effect
 * runtime in the SSR bundle — so there is nothing to install a `Tracer` into and
 * no layer to take the setting from. Cloudflare's automatic instrumentation is
 * the entire trace here, and it is turned on the ADR 0025 way.
 */
export const websiteObservability = {
  ...recordEverything,
  // Every event. This is a low-traffic stack, and a sampled trace is worse than
  // no trace when the request you are chasing is the one that was dropped.
  headSamplingRate: 1,
  traces: { enabled: true },
} as const;
