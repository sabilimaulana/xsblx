import { Api } from "@xsblx/api/api";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import cluster from "node:cluster";
import { CorsConfig, ServerConfig, workerCount } from "./config.ts";
import { AuthRoutes } from "./features/auth/http.ts";
import { AuthenticationLive } from "./features/auth/middleware.ts";
import { HealthHandlers } from "./features/health/http.ts";
import { TodosApiHandlers } from "./features/todos/http.ts";
import { ObservabilityLive } from "./observability.ts";

const ApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, {
    openapiPath: "/openapi.json",
  }).pipe(
    Layer.provide([HealthHandlers, TodosApiHandlers.pipe(Layer.provide(AuthenticationLive))]),
  ),
  AuthRoutes,
);

// The CORS allow-list comes from config, so the server layer is built inside an
// Effect and unwrapped back into a Layer.
const HttpServerLayer = Layer.unwrap(
  Effect.map(CorsConfig, (cors) =>
    HttpRouter.serve(ApiRoutes, {
      middleware: HttpMiddleware.cors({
        allowedOrigins: cors.allowedOrigins,
        // `traceparent` and `b3` are sent by Effect's HttpClient to propagate the
        // trace across the call; without them the browser fails the preflight.
        allowedHeaders: ["content-type", "traceparent", "b3"],
        // Better Auth authenticates with a session cookie, so the browser only
        // sends it — and only accepts the response — when credentials are allowed.
        credentials: true,
      }),
    }),
  ),
).pipe(
  Layer.provide(BunHttpServer.layerConfig(ServerConfig)),
  // Provided beneath the server so every layer and handler below it logs through
  // the configured logger and reports spans to the configured exporter.
  Layer.provide(ObservabilityLive),
);

// The primary only supervises: `cluster` restarts a worker that dies, and every
// worker runs the same `Bun.serve` on the shared port. With WORKERS=1 (the
// default) this branch is skipped entirely and the process serves directly.
const workers = workerCount();
if (cluster.isPrimary && workers > 1) {
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", () => cluster.fork());
} else {
  Layer.launch(HttpServerLayer).pipe(BunRuntime.runMain);
}
