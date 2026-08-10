import { Api } from "@xsblx/api/api";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CorsConfig, ServerConfig } from "./config.ts";
import { AuthRoutes } from "./http/auth.ts";
import { HealthHandlers } from "./http/health.ts";
import { TodosApiHandlers } from "./http/todos.ts";

const ApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, {
    openapiPath: "/openapi.json",
  }).pipe(Layer.provide([HealthHandlers, TodosApiHandlers])),
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
).pipe(Layer.provide(BunHttpServer.layerConfig(ServerConfig)));

Layer.launch(HttpServerLayer).pipe(BunRuntime.runMain);
