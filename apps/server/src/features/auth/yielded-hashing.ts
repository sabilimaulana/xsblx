import { MIN_PASSWORD_LENGTH } from "@xsblx/api/auth/credentials";
import { Password } from "@yielded/auth";
import * as Portable from "@yielded/crypto/Portable";
import { Effect, Layer, Schedule } from "effect";

/**
 * Password hashing (Argon2id from `@yielded/crypto/Portable` — Workers
 * have no native Argon2id, so the owned JS implementation runs on the request
 * thread) plus the new-password policy. Minimum length stays 8 to match the
 * `MIN_PASSWORD_LENGTH` the web forms already enforce.
 *
 * Compromised-password screening is allow-all for now; production wires a
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
 * Argon2id derivations, at most one at a time per isolate.
 *
 * yielded's admission is an isolate-wide semaphore, and on workerd a request
 * must never wait on it: the permit is released from the *holder's* request,
 * so the waiter resumes inside another request's I/O context. That surfaced
 * as `Maximum call stack size exceeded` and "code had hung" cancellations under
 * concurrent sign-ins. So the queue is 0 — a busy isolate answers
 * `PasswordKdfBusy` at once — and the retry below waits on its own timer, in
 * its own request.
 *
 * ponytail: polling, not a FIFO queue. A request gives up after ~20s
 * (80 × 250ms); a derivation holds the permit ~2.5s, so ~8 can be behind one.
 * Effect `Crypto` comes from the auth assembly (`yielded-live.ts`).
 */
const retryWhileBusy = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.retry(effect, {
    while: (error) => error._tag === "PasswordKdfBusy",
    schedule: Schedule.spaced("250 millis"),
    times: 80,
  });

export const HashingLive = Layer.effect(
  Password.PasswordHashing,
  Effect.gen(function* () {
    const hashing = yield* Password.PasswordHashing;
    return Password.PasswordHashing.of({
      hash: (password) => retryWhileBusy(hashing.hash(password)),
      verify: (password, verifier) => retryWhileBusy(hashing.verify(password, verifier)),
      dummy: (password) => retryWhileBusy(hashing.dummy(password)),
    });
  }),
).pipe(
  Layer.provide(Password.PasswordHashing.layer()),
  Layer.provide(Portable.layer(globalThis.crypto.subtle)),
  Layer.provide(Password.PasswordKdfAdmission.layer({ maxQueued: 0 })),
);

export const PasswordPolicyLive = Password.NewPasswordCheck.layer({
  ...Password.defaultPasswordPolicy,
  minimumCodePoints: MIN_PASSWORD_LENGTH,
}).pipe(Layer.provide(ScreeningLive));
