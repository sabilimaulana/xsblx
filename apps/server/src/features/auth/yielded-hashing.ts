import { Password } from "@yielded/auth";
import * as PasswordCrypto from "@yielded/auth-crypto/Password";
import { Effect, Layer } from "effect";

/**
 * Spike: password hashing (Argon2id via WebCrypto, Workers-safe — no native
 * bindings) plus the new-password policy. Minimum length stays 8 to match the
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

export const HashingLive = PasswordCrypto.layer().pipe(
  Layer.provide(Password.PasswordKdfAdmission.layer()),
);

export const PasswordPolicyLive = Password.NewPasswordCheck.layer({
  ...Password.defaultPasswordPolicy,
  minimumCodePoints: 8,
}).pipe(Layer.provide(ScreeningLive));
