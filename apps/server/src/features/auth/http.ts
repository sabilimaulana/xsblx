import type * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

/**
 * `public/*` is the read path for generated assets (ADR 0021). R2 only serves
 * objects anonymously through a custom domain, and this stack owns no zone, so
 * the Worker streams them instead — the object key is the URL path, which is what
 * keeps a stored asset URL a plain string.
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
      yield* Effect.annotateCurrentSpan("key", key);
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
      Effect.withSpan("Assets.get"),
    ),
  );
