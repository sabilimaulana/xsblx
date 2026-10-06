import { Claims } from "@xsblx/api/auth/yielded";
import { Sessions } from "@yielded/auth";
import { Schema as AuthSchema } from "@yielded/auth";
import { coordinateCommit, LifecycleHooks } from "@yielded/auth/Hooks";
import { AuthenticationAssurance } from "@yielded/auth/Operations";
import { hooksLayer } from "@yielded/auth/Persistence";
import { and, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { Db } from "../../db/index.ts";
import { newId } from "../../id.ts";
import { AppAuth } from "./yielded-auth.ts";
import { user } from "./schema.ts";
import { dateTimeFromMillis, fromJson, nowMillis, toJson } from "./yielded-support.ts";
import { passwords, sessionFlows, sessions } from "./yielded-tables.ts";
import { signInRequirement } from "./yielded-storage.ts";

/**
 * Hand-written D1 session ports.
 *
 * Same story as the password ports (see `yielded-password-ports.ts`): the
 * composed layer's interactive kernels cannot run on D1, so
 * `AuthenticationAuthority`, `StatefulSessionPersistence`, and
 * `SessionRepository` are implemented here as sequential D1 statements with
 * per-request I/O and pure layer build. Logic mirrors upstream's
 * custom-store example.
 *
 * Session rows split into columns (identity, digests, revisions, millis
 * timestamps) plus a `record` JSON blob carrying `{claims, provenance,
 * credentialVersion, assurance}` — everything the kernels hand back on
 * `establish` must round-trip, because the core is stateless. DateTimes in
 * the blob use the shared `$yieldedDateTime` codec.
 */

const live = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, Sessions.SessionUnavailable> =>
  Effect.mapError(effect, () => Sessions.SessionUnavailable.make({}));

/** Column accessor by database column name; throws loudly on drift (see password ports). */
const col = (table: SQLiteTable, name: string): AnyColumn => {
  const found = getTableConfig(table).columns.find((column) => column.name === name);
  if (found === undefined) {
    throw new Error(`[yielded-auth] table has no column ${name}`);
  }
  return found as AnyColumn;
};

interface StoredAssurance {
  readonly method: string;
  readonly factors: ReadonlyArray<"knowledge" | "possession" | "inherence">;
  readonly authenticatedAt: DateTime.Utc;
  readonly evidence?: ReadonlyArray<{
    readonly method: string;
    readonly credentialOrdinal?: number;
    readonly factors: ReadonlyArray<"knowledge" | "possession" | "inherence">;
    readonly userVerified: boolean;
    readonly phishingResistant: boolean;
    readonly verifiedAt: DateTime.Utc;
  }>;
}

/**
 * Rebuild the assurance class instance from a round-tripped record.
 *
 * `AuthenticationAssurance` is a `Schema.Class`, not a plain struct: the
 * kernels build one at sign-in (`assessAuthentication`) and `projectSession`
 * re-encodes it on every verify, which rejects the plain object JSON
 * round-trips produce. The stored millis are exact, so rebuilding is
 * lossless — same instant, same evidence, restored prototype.
 */
const reviveAssurance = (assurance: StoredAssurance): AuthenticationAssurance => {
  const evidence = (assurance.evidence ?? []).map((proof) => ({
    method: proof.method,
    ...(proof.credentialOrdinal === undefined
      ? {}
      : { credentialOrdinal: proof.credentialOrdinal }),
    factors: proof.factors,
    userVerified: proof.userVerified,
    phishingResistant: proof.phishingResistant,
    verifiedAt: proof.verifiedAt,
  }));
  const [first, ...rest] = evidence;
  return AuthenticationAssurance.make({
    method: assurance.method,
    factors: assurance.factors,
    authenticatedAt: assurance.authenticatedAt,
    ...(first === undefined ? {} : { evidence: [first, ...rest] }),
  });
};

interface SessionRow {
  readonly sessionId: string;
  readonly subjectId: string;
  readonly digest: string;
  readonly version: string;
  readonly securityRevision: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly record: string;
}

const readSessionById = Effect.fn("YieldedD1.sessionById")(function* (
  db: Db["Service"],
  sessionId: string,
) {
  const rows = (yield* live(
    db
      .select({
        sessionId: col(sessions, "session_id"),
        subjectId: col(sessions, "subject_id"),
        digest: col(sessions, "digest"),
        version: col(sessions, "version"),
        securityRevision: col(sessions, "security_revision"),
        issuedAt: col(sessions, "issued_at"),
        expiresAt: col(sessions, "expires_at"),
        absoluteExpiresAt: col(sessions, "absolute_expires_at"),
        record: col(sessions, "record"),
      })
      .from(sessions)
      .where(eq(col(sessions, "session_id"), sessionId)),
  )) as Array<SessionRow>;
  return rows[0];
});

const readSessionByDigest = Effect.fn("YieldedD1.sessionByDigest")(function* (
  db: Db["Service"],
  digest: string,
) {
  const rows = (yield* live(
    db
      .select({
        sessionId: col(sessions, "session_id"),
        subjectId: col(sessions, "subject_id"),
        digest: col(sessions, "digest"),
        version: col(sessions, "version"),
        securityRevision: col(sessions, "security_revision"),
        issuedAt: col(sessions, "issued_at"),
        expiresAt: col(sessions, "expires_at"),
        absoluteExpiresAt: col(sessions, "absolute_expires_at"),
        record: col(sessions, "record"),
      })
      .from(sessions)
      .where(eq(col(sessions, "digest"), digest)),
  )) as Array<SessionRow>;
  return rows[0];
});

/** A session row is live when the user revision still matches and time holds. */
const validSession = Effect.fn("YieldedD1.validSession")(function* (
  db: Db["Service"],
  row: SessionRow,
  provenanceRevision: Sessions.AuthenticationRevision,
  now: number,
) {
  const accounts = yield* live(db.select().from(user).where(eq(user.id, row.subjectId)));
  const account = accounts[0];
  if (
    account === undefined ||
    account.status !== "active" ||
    account.securityRevision !== row.securityRevision ||
    account.securityRevision !== provenanceRevision.securityRevision
  ) {
    return false;
  }
  const pwRows = (yield* live(
    db
      .select({
        credentialId: col(passwords, "credential_id"),
        credentialRevision: col(passwords, "credential_revision"),
      })
      .from(passwords)
      .where(
        and(
          eq(col(passwords, "module_id"), AppAuth.strategies.password.persistence.moduleId),
          eq(col(passwords, "subject_id"), row.subjectId),
        ),
      ),
  )) as Array<{ readonly credentialId: string; readonly credentialRevision: string }>;
  return (
    provenanceRevision.credentials.every((item) =>
      pwRows.some(
        (actual) =>
          actual.credentialId === item.credentialId && actual.credentialRevision === item.revision,
      ),
    ) && now < Math.min(row.expiresAt, row.absoluteExpiresAt)
  );
});

const satisfies = Effect.fn("YieldedD1.sessionSatisfies")(function* (
  db: Db["Service"],
  evidence: Sessions.AuthenticationEvidence,
) {
  const accounts = yield* live(
    db.select().from(user).where(eq(user.id, evidence.revision.subjectId)),
  );
  const account = accounts[0];
  if (account === undefined || account.status !== "active") return false;
  if (account.securityRevision !== evidence.revision.securityRevision) return false;
  const assessed = yield* live(Sessions.assessAuthentication(evidence, signInRequirement));
  return assessed.satisfied;
});

/** Base claims straight from the user row (the wrapper re-resolves). */
const baseClaims = Effect.fn("YieldedD1.baseClaims")(function* (
  db: Db["Service"],
  subjectId: string,
  identifierValue: string,
) {
  const accounts = yield* live(db.select().from(user).where(eq(user.id, subjectId)));
  const account = accounts[0];
  if (account === undefined || account.status !== "active") {
    return yield* Sessions.SessionInvalid.make({});
  }
  return yield* live(
    Schema.decodeEffect(Claims)({ displayName: account.displayName, email: identifierValue }),
  );
});

export const SessionPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* Db;
    const hooks = yield* LifecycleHooks;

    const withCommit = <A, E, R>(
      owner: (
        journal: Parameters<Parameters<typeof coordinateCommit>[0]>[0],
      ) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | Sessions.SessionUnavailable, R> =>
      coordinateCommit(owner, { mode: "synchronous" }).pipe(
        Effect.map((result) => result.value),
        Effect.catchTag("HookConfigurationError", () => Sessions.SessionUnavailable.make({})),
        Effect.provideService(LifecycleHooks, hooks),
      );

    const authority = Sessions.AuthenticationAuthority.of({
      capture: (subjectId, credentialIds) =>
        Effect.gen(function* () {
          const accounts = yield* live(db.select().from(user).where(eq(user.id, subjectId)));
          const account = accounts[0];
          if (account === undefined || account.status !== "active") {
            return yield* Sessions.StaleAuthentication.make({});
          }
          const pwRows = (yield* live(
            db
              .select({
                credentialId: col(passwords, "credential_id"),
                credentialRevision: col(passwords, "credential_revision"),
              })
              .from(passwords)
              .where(
                and(
                  eq(col(passwords, "module_id"), AppAuth.strategies.password.persistence.moduleId),
                  eq(col(passwords, "subject_id"), subjectId),
                ),
              ),
          )) as Array<{ readonly credentialId: string; readonly credentialRevision: string }>;
          if (!credentialIds.every((id) => pwRows.some((item) => item.credentialId === id))) {
            return yield* Sessions.StaleAuthentication.make({});
          }
          const revision: Sessions.AuthenticationRevision = {
            subjectId: account.id as Sessions.AuthenticationRevision["subjectId"],
            securityRevision:
              account.securityRevision as Sessions.AuthenticationRevision["securityRevision"],
            credentials: pwRows
              .filter((item) => credentialIds.includes(item.credentialId))
              .map((item) => ({
                credentialId: item.credentialId,
                revision:
                  item.credentialRevision as Sessions.AuthenticationRevision["credentials"][number]["revision"],
              })),
          };
          return revision;
        }),
      requirements: (evidence) =>
        Effect.gen(function* () {
          if (!(yield* satisfies(db, evidence))) {
            return yield* Sessions.StaleAuthentication.make({});
          }
          return signInRequirement;
        }),
      approve: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            if (
              input.pending !== undefined ||
              !(yield* satisfies(db, input.evidence)) ||
              now >=
                Math.min(
                  DateTime.toEpochMillis(input.expiresAt),
                  DateTime.toEpochMillis(input.absoluteExpiresAt),
                )
            ) {
              return yield* Sessions.StaleAuthentication.make({});
            }
            return prepare(undefined, journal);
          }),
        ),
    });

    const stateful = AppAuth.sessions.StatefulSessionPersistence.of({
      establish: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            if (
              input.pending !== undefined ||
              !(yield* satisfies(db, input.evidence)) ||
              input.session.subjectId !== input.evidence.revision.subjectId ||
              input.session.securityRevision !== input.evidence.revision.securityRevision ||
              now >=
                Math.min(
                  DateTime.toEpochMillis(input.session.expiresAt),
                  DateTime.toEpochMillis(input.session.absoluteExpiresAt),
                )
            ) {
              return yield* Sessions.StaleAuthentication.make({});
            }
            const flowRows = (yield* live(
              db
                .select({ dedupUntil: col(sessionFlows, "dedup_until") })
                .from(sessionFlows)
                .where(eq(col(sessionFlows, "flow_id"), String(input.evidence.flowId))),
            )) as Array<{ readonly dedupUntil: number }>;
            const digestRows = (yield* live(
              db
                .select({ sessionId: col(sessions, "session_id") })
                .from(sessions)
                .where(eq(col(sessions, "digest"), String(input.session.digest))),
            )) as Array<{ readonly sessionId: string }>;
            if (flowRows.some((row) => row.dedupUntil > now) || digestRows.length > 0) {
              return yield* Sessions.SessionConflict.make({});
            }
            const sessionId = Sessions.SessionId.make(newId());
            const version = Sessions.SecurityRevision.make(newId());
            const record = {
              ...input.session,
              sessionId,
              version,
            };
            const receipt = prepare(record, journal);
            yield* live(
              db.insert(sessions).values({
                sessionId,
                subjectId: String(input.session.subjectId),
                digest: String(input.session.digest),
                version,
                securityRevision: String(input.session.securityRevision),
                issuedAt: DateTime.toEpochMillis(input.session.issuedAt),
                expiresAt: DateTime.toEpochMillis(input.session.expiresAt),
                absoluteExpiresAt: DateTime.toEpochMillis(input.session.absoluteExpiresAt),
                record: toJson(record),
              }),
            );
            yield* live(
              db.insert(sessionFlows).values({
                flowId: String(input.evidence.flowId),
                subjectId: String(input.session.subjectId),
                state: "seen",
                pendingDigest: null,
                dedupUntil: DateTime.toEpochMillis(input.session.absoluteExpiresAt),
              }),
            );
            return receipt;
          }),
        ),
      verify: (input) =>
        Effect.gen(function* () {
          const now = nowMillis();
          const row = yield* readSessionByDigest(db, String(input.digest));
          if (row === undefined) {
            return yield* Sessions.SessionInvalid.make({});
          }
          const parsed = (yield* live(
            Effect.try({
              try: () => fromJson<Record<string, unknown>>(row.record),
              catch: () => Sessions.SessionUnavailable.make({}),
            }),
          )) as {
            readonly claims: typeof Claims.Type;
            readonly provenance: Sessions.SessionAuthenticationProvenance;
            readonly credentialVersion: Sessions.SessionCredentialVersion;
            readonly assurance: StoredAssurance;
          };
          if (!(yield* validSession(db, row, parsed.provenance.evidence.revision, now))) {
            return yield* Sessions.SessionInvalid.make({});
          }
          const assurance = yield* Effect.try({
            try: () => reviveAssurance(parsed.assurance),
            catch: () => Sessions.SessionUnavailable.make({}),
          });
          return {
            sessionId: Sessions.SessionId.make(row.sessionId),
            subjectId: parsed.provenance.evidence.revision.subjectId,
            securityRevision: Sessions.SecurityRevision.make(row.securityRevision),
            assurance,
            issuedAt: dateTimeFromMillis(row.issuedAt),
            expiresAt: dateTimeFromMillis(row.expiresAt),
            absoluteExpiresAt: dateTimeFromMillis(row.absoluteExpiresAt),
            claims: yield* baseClaims(db, row.subjectId, parsed.claims.email),
            digest: AuthSchema.TokenDigest.make(row.digest),
            version: Sessions.SecurityRevision.make(row.version),
            provenance: parsed.provenance,
            credentialVersion: parsed.credentialVersion,
          };
        }),
      rotate: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const row = yield* readSessionById(db, String(input.sessionId));
            if (row === undefined) {
              return yield* Sessions.SessionConflict.make({});
            }
            const parsed = fromJson<{
              readonly provenance: Sessions.SessionAuthenticationProvenance;
              readonly credentialVersion: Sessions.SessionCredentialVersion;
              readonly assurance: StoredAssurance;
              readonly claims: typeof Claims.Type;
            }>(row.record);
            const nextExpiresAt = DateTime.toEpochMillis(input.nextExpiresAt);
            const digestTaken = (yield* live(
              db
                .select({ sessionId: col(sessions, "session_id") })
                .from(sessions)
                .where(eq(col(sessions, "digest"), String(input.nextDigest))),
            )) as Array<{ readonly sessionId: string }>;
            if (
              !(yield* validSession(db, row, parsed.provenance.evidence.revision, now)) ||
              row.digest !== String(input.expectedDigest) ||
              row.version !== String(input.expectedVersion) ||
              row.securityRevision !== String(input.expectedSecurityRevision) ||
              nextExpiresAt <= now ||
              nextExpiresAt > row.absoluteExpiresAt ||
              digestTaken.length > 0
            ) {
              return yield* Sessions.SessionConflict.make({});
            }
            const version = Sessions.SecurityRevision.make(newId());
            const assurance = yield* Effect.try({
              try: () => reviveAssurance(parsed.assurance),
              catch: () => Sessions.SessionUnavailable.make({}),
            });
            const next = {
              sessionId: Sessions.SessionId.make(row.sessionId),
              subjectId: parsed.provenance.evidence.revision.subjectId,
              securityRevision: Sessions.SecurityRevision.make(row.securityRevision),
              assurance,
              issuedAt: dateTimeFromMillis(now),
              expiresAt: dateTimeFromMillis(nextExpiresAt),
              absoluteExpiresAt: dateTimeFromMillis(row.absoluteExpiresAt),
              claims: parsed.claims,
              digest: input.nextDigest,
              version,
              provenance: parsed.provenance,
              credentialVersion: input.nextCredentialVersion,
            };
            const receipt = prepare(next, journal);
            yield* live(
              db
                .update(sessions)
                .set({
                  digest: String(input.nextDigest),
                  issuedAt: now,
                  expiresAt: nextExpiresAt,
                  version,
                  record: toJson(next),
                })
                .where(eq(col(sessions, "session_id"), row.sessionId)),
            );
            return receipt;
          }),
        ),
      revokeDigest: (digest, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const row = yield* readSessionByDigest(db, String(digest));
            const receipt = prepare(row !== undefined, journal);
            yield* live(db.delete(sessions).where(eq(col(sessions, "digest"), String(digest))));
            return receipt;
          }),
        ),
      revoke: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const accounts = yield* live(
              db
                .select()
                .from(user)
                .where(eq(user.id, String(input.subjectId))),
            );
            if (accounts[0]?.securityRevision !== String(input.expectedSecurityRevision)) {
              return yield* Sessions.StaleAuthentication.make({});
            }
            const receipt = prepare(undefined, journal);
            yield* live(
              db
                .delete(sessions)
                .where(
                  and(
                    eq(col(sessions, "subject_id"), String(input.subjectId)),
                    eq(col(sessions, "session_id"), String(input.sessionId)),
                  ),
                ),
            );
            return receipt;
          }),
        ),
      revokeAll: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const accounts = yield* live(
              db
                .select()
                .from(user)
                .where(eq(user.id, String(input.subjectId))),
            );
            if (accounts[0]?.securityRevision !== String(input.expectedSecurityRevision)) {
              return yield* Sessions.StaleAuthentication.make({});
            }
            const receipt = prepare(undefined, journal);
            yield* live(
              db
                .update(user)
                .set({ securityRevision: newId() })
                .where(eq(user.id, String(input.subjectId))),
            );
            yield* live(
              db.delete(sessions).where(eq(col(sessions, "subject_id"), String(input.subjectId))),
            );
            return receipt;
          }),
        ),
    });

    return Context.make(Sessions.AuthenticationAuthority, authority).pipe(
      Context.add(AppAuth.sessions.StatefulSessionPersistence, stateful),
      Context.add(AppAuth.sessions.SessionRepository, {
        list: (input) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const rows = (yield* live(
              db
                .select({
                  sessionId: col(sessions, "session_id"),
                  subjectId: col(sessions, "subject_id"),
                  securityRevision: col(sessions, "security_revision"),
                  issuedAt: col(sessions, "issued_at"),
                  expiresAt: col(sessions, "expires_at"),
                  absoluteExpiresAt: col(sessions, "absolute_expires_at"),
                  record: col(sessions, "record"),
                })
                .from(sessions)
                .where(eq(col(sessions, "subject_id"), String(input.subjectId))),
            )) as Array<SessionRow>;
            const liveRows: Array<{
              readonly sessionId: string;
              readonly assurance: AuthenticationAssurance;
              readonly record: SessionRow;
            }> = [];
            for (const row of rows) {
              const parsed = fromJson<{
                readonly provenance: Sessions.SessionAuthenticationProvenance;
                readonly assurance: StoredAssurance;
              }>(row.record);
              if (
                row.sessionId.localeCompare(String(input.cursor ?? "")) > 0 &&
                (yield* validSession(db, row, parsed.provenance.evidence.revision, now))
              ) {
                const assurance = yield* Effect.try({
                  try: () => reviveAssurance(parsed.assurance),
                  catch: () => Sessions.SessionUnavailable.make({}),
                });
                liveRows.push({
                  sessionId: row.sessionId,
                  assurance,
                  record: row,
                });
              }
            }
            liveRows.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
            const page = liveRows.slice(0, input.limit);
            return {
              sessions: page.map((item) => ({
                sessionId: Sessions.SessionId.make(item.record.sessionId),
                subjectId: AuthSchema.SubjectId.make(item.record.subjectId),
                securityRevision: Sessions.SecurityRevision.make(item.record.securityRevision),
                assurance: item.assurance,
                issuedAt: dateTimeFromMillis(item.record.issuedAt),
                expiresAt: dateTimeFromMillis(item.record.expiresAt),
                absoluteExpiresAt: dateTimeFromMillis(item.record.absoluteExpiresAt),
              })),
              ...(liveRows.length > page.length
                ? { nextCursor: page[page.length - 1]?.sessionId }
                : {}),
            };
          }).pipe(Effect.mapError(() => Sessions.SessionUnavailable.make({}))),
      }),
    );
  }),
).pipe(Layer.provideMerge(hooksLayer));
