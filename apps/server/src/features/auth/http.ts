import type { BetterAuth } from "@alchemy.run/better-auth";
import type * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

/**
 * Better Auth ships its own web-standard `Request -> Response` handler, so it is
 * mounted as a raw route rather than described in `packages/api`: its routes are
 * the library's contract, not ours (ADR 0007).
 *
 * The service is passed in rather than taken from context: a raw route's
 * requirements do not flow into the layer that declares it — `HttpRouter.add`
 * marks them as the *handler's*, so `Layer.provide` cannot satisfy them and they
 * would surface on the Worker's `fetch` type instead. What does stay on the
 * handler is alchemy's `RuntimeContext`, which the Worker bridge provides per
 * event; that one is per-request by nature and cannot be provided any earlier.
 */
export const authRoutes = (betterAuth: BetterAuth["Service"]) =>
  HttpRouter.add("*", "/api/auth/*", betterAuth.fetch);

/**
 * `public/*` is the read path for generated assets (ADR 0021). R2 only serves
 * objects anonymously through a custom domain, and this stack owns no zone, so
 * the Worker streams them instead — the object key is the URL path, which is what
 * keeps a stored avatar URL a plain string.
 *
 * The key is matched against an allow-list pattern before it reaches R2: R2's
 * namespace is flat, so `..` cannot escape a prefix, but a request that does not
 * look like one of our own keys has no business becoming a lookup.
 */
const ASSET_KEY = /^public\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export const assetRoutes = (assets: Cloudflare.R2.ReadBucketClient) =>
  HttpRouter.add(
    "GET",
    "/public/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const key = new URL(request.url, "http://asset.invalid").pathname.slice(1);
      if (!ASSET_KEY.test(key)) {
        return HttpServerResponse.empty({ status: 404 });
      }
      const object = yield* assets.get(key);
      if (object === null) {
        return HttpServerResponse.empty({ status: 404 });
      }
      return HttpServerResponse.stream(object.body, {
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      });
    }).pipe(
      // A failed read is infrastructure, not a route outcome.
      Effect.orDie,
    ),
  );
