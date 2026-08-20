import { BetterAuth } from "@alchemy.run/better-auth";
import { Api } from "@xsblx/api/api";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
// Subpath import: the `alchemy/Drizzle` barrel eagerly loads its MySQL and
// Postgres drivers, which this project does not install.
import { D1 as drizzleD1 } from "alchemy/Drizzle/D1";
import { Effect, Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Assets } from "./assets.ts";
import { ApiDomainConfig, CorsConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { Db } from "./db/index.ts";
import { relations } from "./db/relations.ts";
import { makeBetterAuth } from "./features/auth/auth.ts";
import { assetRoutes, authRoutes } from "./features/auth/http.ts";
import { AuthenticationLive } from "./features/auth/middleware.ts";
import { HealthHandlers } from "./features/health/http.ts";
import { TodosApiHandlers } from "./features/todos/http.ts";
import { Ingest, Logs, Metrics, Traces } from "./observability.ts";

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
  { main: import.meta.url, domain: ApiDomainConfig },
  Effect.gen(function* () {
    const cors = yield* CorsConfig;
    const database = yield* Database;
    const d1 = yield* Cloudflare.D1.QueryDatabase(database);
    const db = yield* drizzleD1(d1, { relations });
    const assets = yield* Cloudflare.R2.ReadWriteBucket(Assets);
    const baseUrl = yield* Cloudflare.Worker.URL;

    const betterAuth = yield* makeBetterAuth({
      database: d1,
      assets,
      baseUrl,
      trustedOrigins: cors.allowedOrigins,
    });

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(
          HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
            Layer.provide([
              HealthHandlers,
              TodosApiHandlers.pipe(Layer.provide(AuthenticationLive)),
            ]),
          ),
          authRoutes(betterAuth),
          assetRoutes(assets),
        ).pipe(
          // The session middleware takes the `BetterAuth` tag rather than the
          // instance, so it stays substitutable; this is where the instance is
          // handed over.
          Layer.provide([Db.layer(db), Layer.succeed(BetterAuth)(betterAuth)]),
          Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
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
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      // The exporter is a binding layer, not an SDK: building it binds each
      // dataset's OTLP endpoint and the ingest token's Authorization header (as
      // a secret) onto the Worker (ADR 0023). Without it Effect's tracer is a
      // no-op and the instrumentation costs nothing.
      Axiom.Telemetry({
        token: Ingest,
        traces: Traces,
        logs: Logs,
        metrics: Metrics,
        // Otherwise `service.name` is the Worker's generated physical name,
        // which carries the stage and changes per stage.
        serviceName: "xsblx-api",
      }),
    ]),
  ),
) {}
