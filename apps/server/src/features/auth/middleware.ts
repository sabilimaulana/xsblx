import { Authentication, CurrentUser, Unauthorized } from "@xsblx/api/auth/middleware";
import { Auth } from "@yielded/auth";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { AppAuth } from "./yielded-auth.ts";

/**
 * Spike: session middleware on yielded-auth.
 *
 * Resolves the session cookie into `CurrentUser` through the yielded session
 * API. Anonymous, expired, or revoked sessions are a 401 (`Unauthorized`),
 * not a defect — every pre-sign-in page load produces one.
 *
 * `AuthRequest` (the validated request the session API needs) must already be
 * in context: the yielded HTTP middleware provides it, so this layer is
 * always composed under yielded's `middleware`, never standalone.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* AppAuth;

    return (httpEffect) =>
      Effect.provideServiceEffect(
        httpEffect,
        CurrentUser,
        // `requireSession` needs the plain `AuthRequest` service, but a
        // middleware implementation may only carry the request marker — the
        // router satisfies the marker per request from the yielded HTTP
        // middleware's provision. The cast states exactly that: same value,
        // same failures, marker in place of the service. (Yielded's own
        // session security does the identical cast.)
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          yield* Effect.annotateCurrentSpan(
            "authPath",
            new URL(request.url, "http://auth.invalid").pathname,
          );
          const session = yield* auth.requireSession().pipe(
            Effect.catchTags({
              SessionInvalid: () => Unauthorized.make(),
              AuthenticationRequired: () => Unauthorized.make(),
            }),
            // Infrastructure failures (D1 down, keys missing) are defects, not
            // 401s — but the `Unauthorized` values above must pass through.
            Effect.catch((rest) =>
              Schema.is(Unauthorized)(rest) ? Effect.fail(rest) : Effect.die(rest),
            ),
          );
          // The owner id is the one attribute worth carrying into the trace: it
          // is an opaque nanoid, so it identifies a request's subject without
          // putting an email address in Cloudflare's span attributes. The email
          // deliberately stays out.
          yield* Effect.annotateCurrentSpan("userId", session.subjectId);
          return { id: session.subjectId, email: session.claims.email };
        }).pipe(
          // The yielded session read verifies a signature and may hit D1, and
          // the two differ by an order of magnitude. Without a span of its own
          // that cost is folded into the handler's.
          Effect.withSpan("Auth.session"),
        ) as unknown as Effect.Effect<
          { readonly id: string; readonly email: string },
          Unauthorized,
          HttpRouter.Request.From<"Requires", Auth.AuthRequest>
        >,
      );
  }),
);
