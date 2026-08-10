import { Authentication, CurrentUser, Unauthorized } from "@xsblx/api/middleware/authentication";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { auth } from "../auth.ts";

/**
 * Resolves the session cookie into `CurrentUser`. Better Auth runs outside the
 * Effect runtime, so its promise is wrapped here; a missing or expired session is
 * a 401, not a defect.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.succeed((httpEffect) =>
    Effect.provideServiceEffect(
      httpEffect,
      CurrentUser,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: (request.source as Request).headers }),
        );
        if (session === null) {
          return yield* new Unauthorized();
        }
        return { id: session.user.id, email: session.user.email };
      }),
    ),
  ),
);
