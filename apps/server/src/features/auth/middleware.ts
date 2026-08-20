import { BetterAuth } from "@alchemy.run/better-auth";
import { Authentication, CurrentUser, Unauthorized } from "@xsblx/api/auth/middleware";
import { RuntimeContext } from "alchemy";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

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
            return yield* Unauthorized.make();
          }
          return { id: session.user.id, email: session.user.email };
        }).pipe(Effect.provide(RuntimeContext.phantom)),
      );
  }),
);
