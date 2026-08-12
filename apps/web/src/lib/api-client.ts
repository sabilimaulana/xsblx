import { Api } from "@xsblx/api/api";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { createEffectQueryFromManagedRuntime } from "effect-query";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

const baseUrl = import.meta.env["VITE_API_URL"] ?? "http://localhost:3000";

/**
 * Typed client generated from the shared `Api` definition — renames and schema
 * changes on the server break this at compile time.
 */
export class ApiClient extends Context.Service<ApiClient, HttpApiClient.ForApi<typeof Api>>()(
  "web/lib/api-client/ApiClient",
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
 * React is plain async code, so a ManagedRuntime is the bridge. Build it once at
 * module scope, never per call.
 */
const runtime = ManagedRuntime.make(ApiClient.layer);

/**
 * `eq.queryOptions` / `eq.mutationOptions` run an Effect inside TanStack Query
 * with `ApiClient` already in context, and surface typed failures as
 * `error.match({ ... })`.
 */
export const eq = createEffectQueryFromManagedRuntime(runtime);

/** `api((client) => client.todos.list())` — the query/mutation fn body. */
export const api = <A, E>(
  f: (client: ApiClient["Service"]) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, ApiClient> => Effect.flatMap(ApiClient, f);
