import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { AppAuth } from "./yielded-auth.ts";

/**
 * Native sign-out. The yielded contract only defines the password actions
 * (register/sign-in), so session teardown is server-owned: it runs the
 * kernel's `signOut` — hooks, revocation commit and all — against the
 * request credential, then clears the cookie.
 *
 * The cookie name mirrors what yielded's HTTP layer sets (`secure: true`
 * forces the `__Host-` prefix). Clearing only needs name + `Path=/` +
 * `Secure` to match; the rest mirrors the set attributes for tidiness.
 *
 * CSRF: the mutation requires the `x-effect-auth-csrf` header, the same
 * convention yielded's own mutations enforce — a cross-origin browser form
 * cannot set a custom header without a preflight, so logout links cannot be
 * forged. Sign-out is idempotent: no/invalid session still returns 200 with
 * a cleared cookie.
 *
 * Like `AuthenticationLive`, this layer must be composed under yielded's
 * `middleware` — `signOut` reads the validated request credential.
 */
const SESSION_COOKIE = "__Host-effect-auth-session";

const clearedCookie =
  `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` as const;

export const signOutRoutes = HttpRouter.add(
  "POST",
  "/api/auth/sign-out",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers["x-effect-auth-csrf"] === undefined) {
      return HttpServerResponse.empty({ status: 403 });
    }
    const auth = yield* AppAuth;
    const result = yield* auth.signOut().pipe(
      Effect.catchTags({
        SessionInvalid: () => Effect.succeed({ invalidation: "already-invalid" as const }),
        AuthenticationRequired: () => Effect.succeed({ invalidation: "already-invalid" as const }),
        SessionSignOutUnavailable: () =>
          Effect.succeed({ invalidation: "already-invalid" as const }),
      }),
      // Anything else (D1 down, keys missing) is infrastructure, not a
      // route outcome.
      Effect.orDie,
    );
    return yield* HttpServerResponse.json(
      {
        signedOut: true,
        // `signOut` returns `SessionSignOutUnavailable` as a *value* when
        // the server cannot revoke: the client still logs out (cookie
        // cleared) but the session lives to expiry — `client-only`, in the
        // kernel's own vocabulary.
        invalidation: "_tag" in result ? "client-only" : result.invalidation,
      },
      { headers: { "set-cookie": clearedCookie } },
    );
  }),
);
