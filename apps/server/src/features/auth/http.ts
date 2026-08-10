import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { auth } from "./auth.ts";

/**
 * Better Auth ships its own web-standard `Request -> Response` handler, so it is
 * mounted as a raw route rather than described in `packages/api`: its routes are
 * the library's contract, not ours.
 */
export const AuthRoutes = HttpRouter.add("*", "/api/auth/*", (request) =>
  Effect.map(
    Effect.promise(() => auth.handler(request.source as Request)),
    // The web `Response` is passed through untouched: the platform layer
    // returns it as-is, so multiple `set-cookie` headers survive (flattening
    // them into a header record would merge them into one broken cookie).
    (response) => HttpServerResponse.raw(response, { status: response.status }),
  ),
);
