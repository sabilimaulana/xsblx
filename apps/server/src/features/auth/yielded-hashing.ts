import { Password } from "@yielded/auth";
import * as Portable from "@yielded/crypto/Portable";
import { Effect, Layer } from "effect";

/**
 * Spike: password hashing (Argon2id from `@yielded/crypto/Portable` — Workers
 * have no native Argon2id, so the owned JS implementation runs on the request
 * thread) plus the new-password policy. Minimum length stays 8 to match the
 * `MIN_PASSWORD_LENGTH` the web forms already enforce.
 *
 * Compromised-password screening is allow-all in the spike; production wires a
 * real corpus or service here (the seam is `Password.CompromisedPasswords`).
 * `ScreeningLive` is exported so the auth assembly provides it at the top
 * level too — the password module requires it directly, not only through
 * `NewPasswordCheck`.
 */
export const ScreeningLive = Layer.succeed(
  Password.CompromisedPasswords,
  Password.CompromisedPasswords.of({
    check: () => Effect.succeed({ _tag: "Allowed" as const }),
  }),
);

/**
 * One `PasswordKdfAdmission` instance feeds both the hasher and the KDF
 * backend, so a single permit bounds every derivation in the isolate. Effect
 * `Crypto` comes from the auth assembly (`yielded-live.ts`).
 */
export const HashingLive = Password.PasswordHashing.layer().pipe(
  Layer.provide(Portable.layer(globalThis.crypto.subtle)),
  Layer.provide(Password.PasswordKdfAdmission.layer()),
);

export const PasswordPolicyLive = Password.NewPasswordCheck.layer({
  ...Password.defaultPasswordPolicy,
  minimumCodePoints: 8,
}).pipe(Layer.provide(ScreeningLive));
