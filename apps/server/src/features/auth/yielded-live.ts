import { Password, Sessions } from "@yielded/auth";
import { EmailDelivery } from "@yielded/auth";
import { layerWebCrypto } from "@yielded/crypto/WebCrypto";
import { Effect, Layer, Option, Schema } from "effect";

import { AppAuth } from "./yielded-auth.ts";
import { HashingLive, PasswordPolicyLive, ScreeningLive } from "./yielded-hashing.ts";
import { KeysLive } from "./yielded-keys.ts";
import { PasswordPortsLive } from "./yielded-password-ports.ts";
import { ClaimsLive } from "./yielded-storage.ts";
import { ProofPortsLive } from "./yielded-proof-ports.ts";
import { SessionPortsLive } from "./yielded-session-ports.ts";

/**
 * yielded service assembly for D1.
 *
 * Mirrors the managed-sqlite example's `live.ts`, minus migrations (alchemy
 * owns DDL from the app schema), email/passkey/TOTP (not built yet), and
 * delivery/screening (no email/SMS yet). Session verification re-checks the
 * password revision so a password change invalidates existing sessions.
 */

const SessionClaimsLive = Layer.effect(
  AppAuth.sessions.StatefulSessionPersistence,
  Effect.gen(function* () {
    const sessions = yield* AppAuth.sessions.StatefulSessionPersistence;
    const passwords = yield* Password.PasswordPersistence;
    const claims = yield* AppAuth.strategies.password.SessionClaims;
    return {
      ...sessions,
      verify: Effect.fn("Yielded.sessionClaims")(
        function* (input) {
          const session = yield* sessions.verify(input);
          const current = yield* passwords.readForSubject({
            moduleId: AppAuth.strategies.password.persistence.moduleId,
            subjectId: session.subjectId,
          });
          if (
            Option.isNone(current) ||
            current.value.revision.subjectId !== session.subjectId ||
            current.value.revision.securityRevision !== session.securityRevision
          ) {
            return yield* Sessions.SessionInvalid.make({});
          }
          return {
            ...session,
            claims: yield* claims.resolve({
              subjectId: current.value.revision.subjectId,
              credential: current.value,
            }),
          };
        },
        Effect.mapError((error) =>
          Schema.is(Sessions.SessionInvalid)(error) ? error : Sessions.SessionUnavailable.make({}),
        ),
      ),
    };
  }),
);

/**
 * Explicit D1 ports for plan AND real boots.
 *
 * The composed `BoundPersistence.layer` builds interactive-transaction
 * kernels and validates storage with live queries at layer build — both die
 * on Workers (proven by the `PersistenceConfigurationError` at isolate
 * boot), so plan-time placeholders are gone: these hand-written ports build
 * pure (no I/O at layer build, queries run per request inside the methods),
 * which makes them safe to construct at plan time AND correct at runtime.
 * The old `PlanPlaceholdersLive` / `usePlanPlaceholders` split is deleted;
 * there is exactly one ports assembly now.
 *
 * What still comes from the composed persistence helper: the table
 * *definitions* (`BoundPersistence.managed` in `yielded-storage.ts`, which
 * owns DDL) and the app `SessionClaims` implementation.
 * `BoundPersistence.layer` itself (kernels, validation, `Config`) is no
 * longer part of any assembly.
 */

/**
 * Delivery fails closed. The management strategy statically requires an
 * `EmailDelivery` service (reset codes are configured), but nothing wires
 * no transport — there is nothing to send through on a Worker without an
 * email provider. Every send fails with `EmailAcceptanceUnknown`, so a reset
 * attempt surfaces a delivery error instead of pretending it worked. A real
 * transport (vendor + sender identity + error mapping) replaces this layer.
 */
const FailClosedDelivery = Layer.succeed(
  EmailDelivery.EmailDelivery,
  EmailDelivery.EmailDelivery.of({
    send: () => Effect.fail(EmailDelivery.EmailAcceptanceUnknown.make({})),
  }),
);

/**
 * Password mutations (change/reset) do not exist yet — signup and
 * sign-in are the whole surface. The password module still requires an
 * action-evidence service statically, so this denies every mutation with
 * `PasswordActionRequired` rather than leaving the tag unprovided. Wiring a
 * real policy here is part of the change-password follow-up.
 */
const PasswordMutationsDeny = Layer.succeed(
  Password.PasswordActionEvidence,
  Password.PasswordActionEvidence.of({
    verify: () => Password.PasswordActionRequired.make({}),
  }),
);

/**
 * The yielded wiring-validation errors (`AuthConfigurationError`,
 * `PersistenceConfigurationError`, `ProofConfigurationError`, ...) can only
 * fire from a programmer mistake in this file — a bad policy, a mis-mapped
 * table, a mismatched contract — never from operator input. They die with
 * their messages instead of widening the Worker's error channel (the one
 * operator-actionable failure, malformed keys, stays a `ConfigError` because
 * `KeysLive` validates through `Config`).
 */
const CoreLive = AppAuth.layer.pipe(
  Layer.provide(PasswordPolicyLive),
  Layer.provideMerge(HashingLive),
  Layer.provide(SessionClaimsLive),
  // The explicit D1 ports (pure build, per-request I/O). `provideMerge`
  // feeds a layer's outputs only backward into the accumulated
  // requirements — never forward into layers merged later. So every provider
  // sits AFTER its consumers: `ClaimsLive` lands after the ports AND the
  // claims wrapper that need it, not before.
  Layer.provideMerge(PasswordPortsLive),
  Layer.provideMerge(SessionPortsLive),
  Layer.provideMerge(ProofPortsLive),
  // Exposed at the top level, not only inside `SessionClaimsLive`'s
  // construction: sign-in resolves claims and screens passwords through the
  // auth layer directly.
  Layer.provideMerge(ClaimsLive),
  Layer.provideMerge(ScreeningLive),
  Layer.provideMerge(FailClosedDelivery),
  Layer.provideMerge(PasswordMutationsDeny),
  // Entropy, SHA digests and HMAC from the isolate's WebCrypto, for every
  // module (sessions, proofs, password hashing).
  Layer.provideMerge(layerWebCrypto),
  Layer.orDie,
);

export const AuthLive = CoreLive.pipe(Layer.provideMerge(KeysLive));
