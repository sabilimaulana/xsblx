import { Api } from "@xsblx/api/api";
import * as Cloudflare from "alchemy/Cloudflare";
// Subpath import: the `alchemy/Drizzle` barrel eagerly loads its MySQL and
// Postgres drivers, which this project does not install.
import { D1 as drizzleD1 } from "alchemy/Drizzle/D1";
import { Effect, Config, Layer, Logger, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Assets } from "./assets.ts";
import { apiObservability, ApiDomainConfig, CorsConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { Db } from "./db/index.ts";
import { relations } from "./db/relations.ts";
import { assetRoutes } from "./features/auth/http.ts";
import { AuthenticationLive } from "./features/auth/middleware.ts";
import { makeYieldedHttp } from "./features/auth/yielded-http.ts";
import { AuthLive } from "./features/auth/yielded-live.ts";
import { signOutRoutes } from "./features/auth/yielded-signout.ts";
import { HealthHandlers } from "./features/health/http.ts";
import { TodosApiHandlers } from "./features/todos/http.ts";

/**
 * There is no filesystem in a Worker isolate, so `HttpPlatform.layer` — which
 * needs one — cannot be provided. Nothing here serves a file: the API answers
 * JSON, and assets stream out of R2.
 */
const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform)({
  platform: "web",
  // workerd implements `CompressionStream`, so the web transform is real; only
  // the file responses below are impossible.
  compression: HttpPlatform.makeCompressionWeb({
    algorithms: ["gzip", "deflate"],
    transform: (algorithm) => HttpPlatform.compressionTransformWeb(algorithm),
  }),
  fileResponse: () => Effect.die("HttpPlatform.fileResponse is not available on workerd"),
  fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse is not available on workerd"),
});

/**
 * The API as a Cloudflare Worker (ADR 0019).
 *
 * The generator is the **init phase**: it runs at plan time and once per isolate
 * at runtime, so it only constructs — it binds resources and builds layers, and
 * never does per-request work. `HttpRouter.toHttpEffect` turns the assembled
 * router into the `fetch` handler Cloudflare invokes.
 *
 * Public on purpose (ADR 0008): the browser calls this Worker directly with the
 * Better Auth session cookie, which is what makes the CORS allow-list and
 * `credentials: true` load-bearing rather than decorative.
 */
export default class ApiWorker extends Cloudflare.Worker<ApiWorker>()(
  "Api",
  // A prop takes a `Config` directly, so the hostname is configuration rather
  // than a literal: a stage that names one serves on it and reports it as `url`,
  // and a stage that does not leaves custom domains unmanaged (ADR 0024).
  //
  // `observability` still carries the log configuration (ADR 0025), but no
  // longer `traces`: `Cloudflare.Telemetry()` below binds those, and a `traces`
  // block written here would win over the bound one and drop its sampling rate.
  //
  // The compatibility date is load-bearing, not housekeeping.
  // `tracing.startActiveSpan` — the API the Effect tracer forwards spans into —
  // exists from 2026-07-28, and alchemy's default is months older; below the
  // floor the deploy fails with `CloudflareTelemetryCompatibilityError` rather
  // than dropping spans quietly. It also clears 2026-08-04, from which
  // `nodejs_compat` is on by default, and the tracer imports `node:async_hooks`
  // (ADR 0026).
  //
  // `env` carries one value and it is a tombstone, not configuration.
  // `ALCHEMY_OTEL_EXPORTERS` is alchemy's own binding for OTLP destinations,
  // and a stale Axiom one survived the migration off it (ADR 0025): the layer
  // reads any bound destination as "an implicit extra destination", so every
  // invocation POSTed metrics to `api.axiom.co/v1/metrics` and got a 403 from
  // the revoked token — ~780ms of wall time per request, buying nothing. The
  // binding is orphaned rather than wrong: nothing declares it any more, so
  // `alchemy deploy --force` leaves it and a Cloudflare settings PATCH reports
  // success without changing it. Declaring it here is what puts it back under
  // the deploy's control; an empty list resolves to `Layer.empty` and the
  // exporter is never built. Delete this once alchemy prunes bindings it no
  // longer declares.
  {
    main: import.meta.url,
    domain: ApiDomainConfig,
    observability: apiObservability,
    compatibility: { date: "2026-08-25" },
    env: { ALCHEMY_OTEL_EXPORTERS: "[]" },
  },
  Effect.gen(function* () {
    const cors = yield* CorsConfig;
    const database = yield* Database;
    const d1 = yield* Cloudflare.D1.QueryDatabase(database);
    const db = yield* drizzleD1(d1, { relations });
    const assets = yield* Cloudflare.R2.ReadWriteBucket(Assets);
    // The API's public origin is explicit stage configuration, not something
    // init can derive: the `Worker.URL` accessor and the raw D1 binding only
    // resolve per request behind alchemy's bridge `RuntimeContext`, which init
    // never has (it runs at plan time and per isolate start). The old Better
    // Auth setup deferred those reads per request behind `Effect.cached`;
    // yielded needs the origin string at build, so the stage declares it.
    // Reading it here also binds it as Worker env (like `AUTH_SECRET`).
    const origin = yield* Config.String("API_PUBLIC_ORIGIN");

    // Yielded owns the whole auth surface. `routes()` is its operation API
    // (register/sign-in/session) with its request handling baked in — the
    // managed-sqlite example mounts it standalone, no extra wrapping.
    // The app Api keeps its own `Authentication` middleware, but that
    // middleware resolves sessions through yielded's validated request, so
    // the Api routes get `yielded.middleware` applied: it parses cookies and
    // provides `AuthRequest` per request (kind "request" performs no origin
    // or CSRF rejection — it only makes the credentials available), which
    // `Authentication` declares in `requires`.
    const yielded = makeYieldedHttp(origin);
    const apiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
      Layer.provide([HealthHandlers, TodosApiHandlers.pipe(Layer.provide(AuthenticationLive))]),
      // The request middleware validates its static configuration (origin
      // shape, cookie names) at build; a failure is wiring in this file, so
      // it dies rather than widening the Worker's error channel. Per-request
      // failures stay typed inside the middleware.
      (routes) => Layer.orDie(yielded.middleware(routes)),
    );
    // `routes()` builds yielded's operation API; a build failure here (cookie
    // mismatch, contract drift) is a wiring defect in this file, not an
    // operator error, so it dies instead of widening the Worker's channel.
    const yieldedHttp = Layer.orDie(yielded.routes());
    // Native sign-out runs under the same request middleware: `signOut`
    // reads the validated request credential, so it needs `AuthRequest`
    // exactly like the contract actions do.
    const signOutHttp = Layer.orDie(yielded.middleware(signOutRoutes));

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(apiRoutes, yieldedHttp, signOutHttp, assetRoutes(assets)).pipe(
          // The session middleware takes the yielded `AppAuth` tag rather
          // than an instance, so it stays substitutable. Each `provide`
          // feeds one layer's outputs downward while that layer's own
          // requirements stay open for the next — a single
          // `provide([AuthLive, Db.layer(db), ...])` would NOT let the
          // sibling layers satisfy `AuthLive`'s `Db`/`SqlClient` needs.
          // The full yielded stack (auth service, D1 persistence, keys) is
          // handed over here.
          Layer.provide(AuthLive),
          Layer.provide(Db.layer(db)),
          // `consoleStructured`, not `consoleJson`: it hands `console.log` the
          // record as an *object*, and Workers Logs indexes a logged object's
          // fields into queryable columns. A JSON string would arrive as one
          // opaque message, searchable only by text match (ADR 0025).
          //
          // `Logger.layer` replaces the default logger set rather than merging
          // with it, which is what we want — one indexed record per log, no
          // second pretty copy of every line.
          Layer.provide([
            Etag.layer,
            HttpPlatformStub,
            Path.layer,
            Logger.layer([Logger.consoleStructured]),
          ]),
          Layer.provide(
            HttpRouter.cors({
              allowedOrigins: cors.allowedOrigins,
              // `traceparent` and `b3` are sent by Effect's `HttpClient` to
              // propagate the trace across the call; without them the browser
              // fails the preflight.
              allowedHeaders: ["content-type", "traceparent", "b3"],
              // Better Auth authenticates with a session cookie, so the browser
              // only sends it — and only accepts the response — when credentials
              // are allowed.
              credentials: true,
            }),
          ),
        ),
      ),
    };
  }).pipe(
    // `Cloudflare.Telemetry()` is the whole trace export (ADR 0026). It turns on
    // `observability.traces` for this Worker and installs a per-event Effect
    // `Tracer` over `tracing.startActiveSpan`, so `Effect.fn("Todos.list")`
    // frames nest inside Cloudflare's own fetch and D1 spans. There is still no
    // exporter, no OTLP endpoint and no flush — Cloudflare owns sampling and
    // submission — and the only credential this Worker carries is `AUTH_SECRET`.
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      // Every event, for the reason ADR 0025 gave when this was a prop: on a
      // low-traffic stack a sampled trace is worse than no trace, because the
      // request you are chasing is the one that was dropped.
      Cloudflare.Telemetry({ headSamplingRate: 1 }),
    ]),
  ),
) {}
