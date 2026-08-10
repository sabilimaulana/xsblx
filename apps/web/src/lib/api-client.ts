import { Api } from "@xsblx/api/api";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

const baseUrl = import.meta.env["VITE_API_URL"] ?? "http://localhost:3000";

/**
 * Typed client generated from the shared `Api` definition — renames and schema
 * changes on the server break this at compile time.
 */
export class ApiClient extends Context.Service<ApiClient, HttpApiClient.ForApi<typeof Api>>()(
  "web/ApiClient",
) {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(Api, {
      transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)),
    }),
  ).pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(
        // The API authenticates with the Better Auth session cookie, which is
        // cross-origin (web on 3001, API on 3000), so fetch only sends it when
        // credentials are included.
        Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ credentials: "include" })),
      ),
    ),
  );
}

/**
 * TanStack loaders and event handlers are plain async code, so a ManagedRuntime
 * is the bridge. Build it once at module scope, never per call.
 */
const runtime = ManagedRuntime.make(ApiClient.layer);

export const runApi = <A, E>(
  f: (client: ApiClient["Service"]) => Effect.Effect<A, E, never>,
): Promise<A> => runtime.runPromise(Effect.flatMap(ApiClient, f));
