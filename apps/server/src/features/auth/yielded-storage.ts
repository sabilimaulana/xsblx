import { Claims } from "@xsblx/api/auth/yielded";
import { Password, Sessions } from "@yielded/auth";
import { Schema as AuthSchema } from "@yielded/auth";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { Db } from "../../db/index.ts";
import { AppAuth } from "./yielded-auth.ts";
import { user } from "./schema.ts";
import { BoundPersistence } from "./yielded-persistence.ts";

/**
 * The yielded subject mapping onto the `user` table plus claims.
 *
 * The `user` row is the subject: `id` is the subject id, `displayName` the
 * profile name, `status` gates sign-in (`"active"` admits),
 * `securityRevision` binds password-bound sessions. The login email lives
 * only in yielded's identifiers table — registration (the password ports)
 * writes it there in the same batch as the `user` row, and claims resolve it
 * from there. No dual-write anywhere.
 */

export const signInRequirement = Sessions.AuthenticationRequirement.make({
  alternatives: [
    {
      factors: ["knowledge"],
      userVerified: false,
      phishingResistant: false,
      minimumCredentials: 1,
    },
  ],
  maximumAgeMillis: 300_000,
});

export const storage = BoundPersistence.managed({
  subjects: {
    table: user,
    id: "id",
    status: "status",
    activeValue: "active",
    securityRevision: "securityRevision",
    idCodec: AuthSchema.SubjectId,
    requirements: () => Effect.succeed(signInRequirement),
  },
  prefix: "xsblx_auth",
});

/** Managed auth tables join the app schema so alchemy migrates them. */
export const authSchema = storage.schema;

export const ClaimsLive = Layer.effect(
  AppAuth.strategies.password.SessionClaims,
  Effect.gen(function* () {
    const db = yield* Db;
    return {
      resolve: Effect.fn("YieldedClaims.resolve")(
        function* ({
          subjectId,
          credential,
        }: {
          readonly subjectId: string;
          readonly credential: { readonly identifier: { readonly value: string } };
        }) {
          const rows = yield* db.select().from(user).where(eq(user.id, subjectId));
          const row = rows[0];
          if (row === undefined || row.status !== "active") {
            return yield* Password.PasswordUnavailable.make({});
          }
          return yield* Schema.decodeEffect(Claims)({
            displayName: row.displayName,
            email: credential.identifier.value,
          });
        },
        Effect.mapError(() => Password.PasswordUnavailable.make({})),
      ),
    };
  }),
);
