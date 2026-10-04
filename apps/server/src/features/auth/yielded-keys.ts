import { Auth, Proofs } from "@yielded/auth";
import { Config, Effect, Layer, Schema } from "effect";

/**
 * Spike: session proof + request-binding keyrings.
 *
 * Better Auth signed everything off one `AUTH_SECRET`. Yielded separates the
 * proof key (session validity) from the request-binding key (CSRF-grade
 * request credentials). Both arrive as Worker secrets; generate with
 * `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` (32 bytes, base64url).
 *
 * Validation stays inside `Config`, so a missing or malformed key fails as a
 * `ConfigError` — the one operator-actionable failure in the yielded stack —
 * rather than a bespoke error type. The pattern pins the shape: 43+ base64url
 * chars decode to 32+ bytes. Rotation story is a follow-up: the keyring
 * supports multiple key ids, but the spike runs a single `v1` key.
 */
const KeyMaterial = Schema.Redacted(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{43,}$/))),
);

const KeysSchema = Schema.Struct({
  proof: KeyMaterial,
  binding: KeyMaterial,
});

const loadKeys = Effect.gen(function* () {
  const raw = yield* Config.all({
    proof: Config.Redacted("AUTH_PROOF_KEY"),
    binding: Config.Redacted("AUTH_BINDING_KEY"),
  });
  // `decodeEffect` fails with `SchemaError`, which is exactly what the
  // `ConfigError` constructor takes — the schema message stays intact.
  return yield* Schema.decodeEffect(KeysSchema)(raw).pipe(
    Effect.mapError((issue) => new Config.ConfigError(issue)),
  );
});

export const KeysLive = Layer.unwrap(
  Effect.gen(function* () {
    const keys = yield* loadKeys;
    // The keyring shapes are static wiring in this file — a validation
    // failure here is our bug, not the operator's, so it dies. The key
    // VALUES above stay a `ConfigError`: those are the operator's.
    return Layer.mergeAll(
      Proofs.ProofKeys.layer({ activeKeyId: "v1", keys: [{ id: "v1", material: keys.proof }] }),
      Auth.RequestBindingConfig.layer({
        keyring: { activeKeyId: "v1", keys: [{ id: "v1", material: keys.binding }] },
        lifetimeMillis: 300_000,
        generation: 1,
      }),
    ).pipe(Layer.orDie);
  }),
);
