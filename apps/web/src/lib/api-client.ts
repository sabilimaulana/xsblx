import { Api } from "@xsblx/api/api";
import { XsblxAuthApi } from "@xsblx/api/auth/yielded";
import { Client } from "@yielded/auth";
import { layerCryptoWeb } from "@yielded/crypto/WebCrypto";
import { Context, Crypto, Effect, Layer, ManagedRuntime } from "effect";
import { createEffectQueryFromManagedRuntime } from "effect-query";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

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
        // The API authenticates with the yielded session cookie, which is
        // cross-origin (web on 3001, API on 3000), so fetch only sends it when
        // credentials are included.
        Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ credentials: "include" })),
      ),
    ),
  );
}

/**
 * The yielded auth client, built from the same contract the server mounts
 * (ADR 0030). `layerFetch` includes credentials and sends the CSRF header on
 * mutations, so sign-in sets the session cookie the `Api` client then carries.
 */
export const AuthClient = Client.make(XsblxAuthApi, { baseUrl });

/**
 * React is plain async code, so a ManagedRuntime is the bridge. Build it once at
 * module scope, never per call.
 */
const runtime = ManagedRuntime.make(
  // A failure building the auth client is a bad `baseUrl` — our wiring, not
  // an outcome — so it dies rather than typing every query with it.
  // `Crypto` is the browser's WebCrypto, for ids the client mints itself.
  Layer.mergeAll(ApiClient.layer, Layer.orDie(AuthClient.layerFetch), layerCryptoWeb),
);

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

type AuthClient = typeof AuthClient;

/** `auth((client) => client.getSession())` — the auth twin of `api`. */
export const auth = <A, E>(
  f: (client: AuthClient["Service"]["auth"]) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E, AuthClient["Identifier"]> =>
  Effect.flatMap(AuthClient, (service) => f(service.auth));

/** A fresh UUIDv4 from WebCrypto; a browser without it is a defect. */
export const randomId = Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv4).pipe(
  Effect.orDie,
);
