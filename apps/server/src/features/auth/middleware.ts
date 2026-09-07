import { Authentication, CurrentUser, Unauthorized } from "@xsblx/api/auth/middleware";
import { RuntimeContext } from "alchemy";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { BetterAuth } from "./auth.ts";

/**
 * Resolves the session cookie into `CurrentUser`. Better Auth runs outside the
 * Effect runtime, so its promise is wrapped here; a missing or expired session is
 * a 401, not a defect.
 *
 * `RuntimeContext.phantom` is an empty layer that only erases a type: the D1
 * binding behind Better Auth resolves lazily and therefore carries alchemy's
 * `RuntimeContext` in its requirements, and `HttpApiMiddleware` admits nothing
 * beyond what it provides. Erasing it here is what keeps that requirement — and
 * alchemy itself — out of `packages/api`'s middleware contract. Nothing is
 * shadowed, because the layer provides nothing: when the handler actually runs,
 * the Worker bridge's own runtime context is still the one in scope.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const betterAuth = yield* BetterAuth;

    return (httpEffect) =>
      Effect.provideServiceEffect(
        httpEffect,
        CurrentUser,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const auth = yield* betterAuth.auth;
          const session = yield* Effect.promise(() =>
            auth.api.getSession({ headers: (request.source as Request).headers }),
          );
          if (session === null) {
            // Every pre-sign-in page load produces one of these, and the tracer
            // marks the span `effect.exit: "failure"` regardless. Without this
            // attribute an ordinary anonymous request is indistinguishable from
            // auth actually being broken.
            yield* Effect.annotateCurrentSpan("outcome", "no-session");
            return yield* Unauthorized.make();
          }
          // The owner id is the one attribute worth carrying into the trace: it
          // is an opaque nanoid, so it identifies a request's subject without
          // putting an email address in Cloudflare's span attributes. The email
          // deliberately stays out.
          yield* Effect.annotateCurrentSpan("userId", session.user.id);
          return { id: session.user.id, email: session.user.email };
        }).pipe(
          Effect.provide(RuntimeContext.phantom),
          // Better Auth's session cookie cache means this either verifies a
          // signature or hits D1, and the two differ by an order of magnitude.
          // Without a span of its own that cost is folded into the handler's.
          Effect.withSpan("Auth.session"),
        ),
      );
  }),
);
