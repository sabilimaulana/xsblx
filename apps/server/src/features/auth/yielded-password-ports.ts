import { Password, Sessions } from "@yielded/auth";
import { Schema as AuthSchema } from "@yielded/auth";
import { coordinateCommit, LifecycleHooks } from "@yielded/auth/Hooks";
import { hooksLayer } from "@yielded/auth/Persistence";
import { and, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";

import { Db } from "../../db/index.ts";
import { newId } from "../../id.ts";
import { AppAuth } from "./yielded-auth.ts";
import { user } from "./schema.ts";
import { BoundPersistence } from "./yielded-persistence.ts";
import { consumeProofCompletion, proofCompletionCurrent } from "./yielded-proof-ports.ts";
import { nowMillis } from "./yielded-support.ts";
import {
  credentials,
  identifiers,
  passwordAttempts,
  passwordCharges,
  passwordCommands,
  passwordRegistrations,
  passwords,
} from "./yielded-tables.ts";

/**
 * Spike (yielded-auth): hand-written D1 password ports.
 *
 * The composed `BoundPersistence.layer` builds the *interactive-transaction*
 * SQL kernels and validates storage with live queries at layer build — both
 * die on Workers (no D1 at init, no interactive transactions on D1), which is
 * what the `PersistenceConfigurationError` at isolate boot proved. These
 * ports implement the same `PasswordPersistence` + `RegistrationAuthority`
 * contracts as sequential D1 statements through the `Db` handle: reads and
 * writes happen per request inside the port methods, layer build stays pure,
 * and each mutating method runs inside `coordinateCommit` so the kernel's
 * `prepare` receives a real journal.
 *
 * Logic mirrors upstream's custom-store example (same decisions, same
 * idempotency, same abuse budgets); only the storage backend differs
 * (D1 rows instead of process memory). Deliberate simplifications, all
 * fail-closed:
 * - settle comparisons are field-wise, not snapshot-JSON equality (the
 *   attempts table carries the compared fields, not a snapshot blob);
 *   every predicate the memory version checks is still checked.
 * - `addIfAbsent` denies: every subject has exactly one password, created at
 *   signup — same call the custom example makes.
 * - change/reset mutations are fully implemented but unreachable: action
 *   evidence denies upstream (`PasswordMutationsDeny`), and reset bindings
 *   can never be current (identifiers are never verified — see proof ports).
 */

const moduleId = AppAuth.strategies.password.persistence.moduleId;

/**
 * Column accessor by database column name; throws loudly on drift. The
 * managed tables are built dynamically so their TS keys are loose — every
 * query addresses columns by db name with explicit select aliases.
 */
const col = (table: SQLiteTable, name: string): AnyColumn => {
  const found = getTableConfig(table).columns.find((column) => column.name === name);
  if (found === undefined) {
    throw new Error(`[yielded-auth spike] table has no column ${name}`);
  }
  return found as AnyColumn;
};

/** The single password credential id for a subject (globally unique). */
const credentialIdFor = (subjectId: string): string => `pwd-${subjectId}`;

const live = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, Password.PasswordUnavailable> =>
  Effect.mapError(effect, () => Password.PasswordUnavailable.make({}));

interface ScopeBudget {
  readonly kind: string;
  readonly key: string;
  readonly limit: number;
  readonly windowMillis: number;
}

/** Charge every open bucket (even when another bucket denies), like upstream. */
const charge = Effect.fn("YieldedD1.charge")(function* (
  db: Db["Service"],
  action: string,
  attemptId: string,
  scopes: ReadonlyArray<ScopeBudget>,
  now: number,
) {
  const open: Array<ScopeBudget> = [];
  for (const scope of scopes) {
    const recent = (yield* live(
      db
        .select({ occurredAt: col(passwordCharges, "occurred_at") })
        .from(passwordCharges)
        .where(
          and(
            eq(col(passwordCharges, "module_id"), moduleId),
            eq(col(passwordCharges, "action"), action),
            eq(col(passwordCharges, "scope_kind"), scope.kind),
            eq(col(passwordCharges, "scope_key"), scope.key),
          ),
        ),
    )) as Array<{ readonly occurredAt: number }>;
    if (recent.filter((row) => row.occurredAt >= now - scope.windowMillis).length < scope.limit) {
      open.push(scope);
    }
  }
  for (const scope of open) {
    yield* live(
      db.insert(passwordCharges).values({
        moduleId,
        action,
        scopeKind: scope.kind,
        scopeKey: scope.key,
        attemptId,
        occurredAt: now,
        retentionUntil: now + scope.windowMillis,
      }),
    );
  }
  return open.length === scopes.length;
});

/** Resolve a login email to its active subject, or undefined. */
const subjectForEmail = Effect.fn("YieldedD1.subjectForEmail")(function* (
  db: Db["Service"],
  email: string,
) {
  const idRows = (yield* live(
    db
      .select({ subjectId: col(identifiers, "subject_id") })
      .from(identifiers)
      .where(
        and(
          eq(col(identifiers, "namespace"), "email"),
          eq(col(identifiers, "value"), email),
          eq(col(identifiers, "active"), 1),
        ),
      ),
  )) as Array<{ readonly subjectId: string }>;
  const subjectId = idRows[0]?.subjectId;
  if (subjectId === undefined) return undefined;
  const users = yield* live(db.select().from(user).where(eq(user.id, subjectId)));
  return users[0];
});

/** The live password snapshot for a subject, or none. */
const readSnapshot = Effect.fn("YieldedD1.passwordSnapshot")(function* (
  db: Db["Service"],
  subjectId: string,
) {
  const accounts = yield* live(db.select().from(user).where(eq(user.id, subjectId)));
  const account = accounts[0];
  if (account === undefined || account.status !== "active") return Option.none();
  const idRows = (yield* live(
    db
      .select({
        namespace: col(identifiers, "namespace"),
        value: col(identifiers, "value"),
        revision: col(identifiers, "revision"),
        verifiedAt: col(identifiers, "verified_at"),
      })
      .from(identifiers)
      .where(
        and(
          eq(col(identifiers, "subject_id"), subjectId),
          eq(col(identifiers, "namespace"), "email"),
          eq(col(identifiers, "active"), 1),
        ),
      ),
  )) as Array<{
    readonly namespace: string;
    readonly value: string;
    readonly revision: string;
    readonly verifiedAt: number | null;
  }>;
  const idRow = idRows[0];
  const pwRows = (yield* live(
    db
      .select({
        credentialId: col(passwords, "credential_id"),
        credentialRevision: col(passwords, "credential_revision"),
        verifierVersion: col(passwords, "verifier_version"),
        verifier: col(passwords, "verifier"),
        normalization: col(passwords, "normalization"),
      })
      .from(passwords)
      .where(
        and(eq(col(passwords, "module_id"), moduleId), eq(col(passwords, "subject_id"), subjectId)),
      ),
  )) as Array<{
    readonly credentialId: string;
    readonly credentialRevision: string;
    readonly verifierVersion: string;
    readonly verifier: string;
    readonly normalization: string;
  }>;
  const pwRow = pwRows[0];
  if (idRow === undefined || pwRow === undefined) return Option.none();
  const snapshot = yield* live(
    Schema.decodeEffect(Password.PasswordCredentialSnapshot)({
      moduleId,
      revision: {
        subjectId: account.id,
        securityRevision: account.securityRevision ?? "",
        credentials: [{ credentialId: pwRow.credentialId, revision: pwRow.credentialRevision }],
      },
      credentialId: pwRow.credentialId,
      credentialRevision: pwRow.credentialRevision,
      verifierVersion: pwRow.verifierVersion,
      verifier: pwRow.verifier,
      normalization: pwRow.normalization as "none" | "NFC",
      identifier: { namespace: idRow.namespace, value: idRow.value },
      identifierBindingRevision: idRow.revision,
      ...(idRow.verifiedAt === null ? {} : { identifierVerifiedAtMillis: idRow.verifiedAt }),
    }),
  );
  return Option.some(snapshot);
});

/** A captured revision is current when the user and credential rows still match. */
const revisionCurrent = Effect.fn("YieldedD1.revisionCurrent")(function* (
  db: Db["Service"],
  revision: Sessions.AuthenticationRevision,
) {
  const accounts = yield* live(db.select().from(user).where(eq(user.id, revision.subjectId)));
  const account = accounts[0];
  if (
    account === undefined ||
    account.status !== "active" ||
    account.securityRevision !== revision.securityRevision
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
          eq(col(passwords, "module_id"), moduleId),
          eq(col(passwords, "subject_id"), revision.subjectId),
        ),
      ),
  )) as Array<{ readonly credentialId: string; readonly credentialRevision: string }>;
  return revision.credentials.every((item) =>
    pwRows.some(
      (actual) =>
        actual.credentialId === item.credentialId && actual.credentialRevision === item.revision,
    ),
  );
});

const satisfies = Effect.fn("YieldedD1.satisfies")(function* (
  db: Db["Service"],
  evidence: Sessions.AuthenticationEvidence,
  requirement: Sessions.AuthenticationRequirement,
) {
  if (!(yield* revisionCurrent(db, evidence.revision))) return false;
  const assessed = yield* live(Sessions.assessAuthentication(evidence, requirement));
  return assessed.satisfied;
});

/** Replace the password and invalidate every session (bump + delete). */
const replace = Effect.fn("YieldedD1.replace")(function* (
  db: Db["Service"],
  subjectId: string,
  credentialId: string,
  replacement: Password.PasswordReplacement,
) {
  const credentialRevision = newId();
  yield* live(
    db
      .update(passwords)
      .set({
        credentialRevision,
        verifierVersion: newId(),
        verifier: Redacted.value(replacement.verifier),
        normalization: replacement.normalization,
      })
      .where(
        and(
          eq(col(passwords, "module_id"), moduleId),
          eq(col(passwords, "credential_id"), credentialId),
        ),
      ),
  );
  yield* live(
    db
      .update(credentials)
      .set({ revision: credentialRevision })
      .where(eq(col(credentials, "credential_id"), credentialId)),
  );
  yield* live(db.update(user).set({ securityRevision: newId() }).where(eq(user.id, subjectId)));
});

const recordCommand = Effect.fn("YieldedD1.recordCommand")(function* (
  db: Db["Service"],
  commandId: string,
  action: string,
  bindingDigest: string,
  decision: string,
  now: number,
) {
  yield* live(
    db.insert(passwordCommands).values({
      moduleId,
      commandId,
      action,
      bindingDigest,
      decision,
      retentionUntil: now + 3_600_000,
    }),
  );
});

export const PasswordPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* Db;
    const hooks = yield* LifecycleHooks;
    const provisioning = yield* BoundPersistence.Provisioning;

    const withCommit = <A, E, R>(
      owner: (
        journal: Parameters<Parameters<typeof coordinateCommit>[0]>[0],
      ) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | Password.PasswordUnavailable, R> =>
      coordinateCommit(owner, { mode: "synchronous" }).pipe(
        Effect.map((result) => result.value),
        Effect.catchTag("HookConfigurationError", () => Password.PasswordUnavailable.make({})),
        Effect.provideService(LifecycleHooks, hooks),
      );

    const persistence = Password.PasswordPersistence.of({
      admitAttempt: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            if (input.moduleId !== moduleId) {
              return prepare({ _tag: "Denied" }, journal);
            }
            const subject =
              input.identifier.namespace === "email"
                ? yield* subjectForEmail(db, input.identifier.value)
                : undefined;
            const accounts = subject === undefined ? [] : [subject];
            const account = accounts.find(
              (row) =>
                row.status === "active" &&
                input.identifier.namespace === "email" &&
                (input.subjectId === undefined || row.id === input.subjectId),
            );
            const captured =
              account === undefined ? undefined : yield* readSnapshot(db, account.id);
            const credential =
              captured !== undefined && Option.isSome(captured)
                ? { credential: captured.value }
                : {};
            const scopes: Array<ScopeBudget> = [
              { kind: "global", key: "global", ...input.policy.action },
              {
                kind: "identifier",
                key: `${input.identifier.namespace}/${input.identifier.value}`,
                ...input.policy.identifier,
              },
              ...(account === undefined
                ? []
                : [{ kind: "subject", key: account.id, ...input.policy.subject }]),
            ];
            const attemptId = Password.PasswordAttemptId.make(newId());
            const admitted = yield* charge(db, input.action, attemptId, scopes, now);
            const pending = (yield* live(
              db
                .select({
                  attemptId: col(passwordAttempts, "attempt_id"),
                  deadline: col(passwordAttempts, "deadline"),
                })
                .from(passwordAttempts)
                .where(
                  and(
                    eq(col(passwordAttempts, "module_id"), moduleId),
                    eq(col(passwordAttempts, "state"), "pending"),
                  ),
                ),
            )) as Array<{ readonly attemptId: string; readonly deadline: number }>;
            if (
              !admitted ||
              pending.filter((row) => row.deadline > now).length >= input.policy.maximumPending
            ) {
              return prepare({ _tag: "Denied" }, journal);
            }
            const snapshot =
              captured !== undefined && Option.isSome(captured) ? captured.value : undefined;
            yield* live(
              db.insert(passwordAttempts).values({
                moduleId,
                action: input.action,
                attemptId,
                identifierNamespace: input.identifier.namespace,
                identifierValue: input.identifier.value,
                subjectId: snapshot?.revision.subjectId,
                credentialId: snapshot?.credentialId,
                securityRevision: snapshot?.revision.securityRevision,
                credentialRevision: snapshot?.credentialRevision,
                verifierVersion: snapshot?.verifierVersion,
                identifierBindingRevision: snapshot?.identifierBindingRevision,
                admittedAt: now,
                deadline: now + input.policy.attemptLifetimeMillis,
                retentionUntil:
                  now +
                  Math.max(
                    input.policy.attemptLifetimeMillis,
                    ...scopes.map((scope) => scope.windowMillis),
                  ),
                state: "pending",
              }),
            );
            return prepare({ _tag: "Admitted", attemptId, ...credential }, journal);
          }),
        ),
      settleAttempt: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const rows = (yield* live(
              db
                .select({
                  attemptId: col(passwordAttempts, "attempt_id"),
                  action: col(passwordAttempts, "action"),
                  identifierNamespace: col(passwordAttempts, "identifier_namespace"),
                  identifierValue: col(passwordAttempts, "identifier_value"),
                  subjectId: col(passwordAttempts, "subject_id"),
                  credentialId: col(passwordAttempts, "credential_id"),
                  securityRevision: col(passwordAttempts, "security_revision"),
                  credentialRevision: col(passwordAttempts, "credential_revision"),
                  verifierVersion: col(passwordAttempts, "verifier_version"),
                  identifierBindingRevision: col(passwordAttempts, "identifier_binding_revision"),
                  deadline: col(passwordAttempts, "deadline"),
                  state: col(passwordAttempts, "state"),
                })
                .from(passwordAttempts)
                .where(
                  and(
                    eq(col(passwordAttempts, "module_id"), moduleId),
                    eq(col(passwordAttempts, "attempt_id"), input.attemptId),
                  ),
                ),
            )) as Array<{
              readonly attemptId: string;
              readonly action: string;
              readonly identifierNamespace: string;
              readonly identifierValue: string;
              readonly subjectId: string | null;
              readonly credentialId: string | null;
              readonly securityRevision: string | null;
              readonly credentialRevision: string | null;
              readonly verifierVersion: string | null;
              readonly identifierBindingRevision: string | null;
              readonly deadline: number;
              readonly state: string;
            }>;
            const attempt = rows[0];
            const captured = input.captured;
            const actual =
              attempt?.subjectId === undefined || attempt.subjectId === null
                ? undefined
                : yield* readSnapshot(db, attempt.subjectId);
            const actualValue =
              actual !== undefined && Option.isSome(actual) ? actual.value : undefined;
            const verified =
              input.moduleId === moduleId &&
              input.outcome === "verified" &&
              attempt !== undefined &&
              attempt.state === "pending" &&
              attempt.deadline > now &&
              captured !== undefined &&
              actualValue !== undefined &&
              captured.credentialId === attempt.credentialId &&
              captured.credentialRevision === attempt.credentialRevision &&
              captured.identifierBindingRevision === attempt.identifierBindingRevision &&
              captured.identifier.value === attempt.identifierValue &&
              captured.credentialId === actualValue.credentialId &&
              captured.credentialRevision === actualValue.credentialRevision &&
              captured.identifierBindingRevision === actualValue.identifierBindingRevision &&
              captured.identifier.value === actualValue.identifier.value &&
              (yield* revisionCurrent(db, captured.revision));
            const receipt = prepare(verified ? "verified" : "rejected", journal);
            yield* live(
              db
                .update(passwordAttempts)
                .set({ state: "settled" })
                .where(
                  and(
                    eq(col(passwordAttempts, "module_id"), moduleId),
                    eq(col(passwordAttempts, "attempt_id"), input.attemptId),
                  ),
                ),
            );
            const rehash = input.rehash;
            if (
              verified &&
              rehash !== undefined &&
              captured !== undefined &&
              actualValue !== undefined
            ) {
              yield* live(
                db
                  .update(passwords)
                  .set({
                    verifier: Redacted.value(rehash.nextVerifier),
                    verifierVersion: newId(),
                  })
                  .where(
                    and(
                      eq(col(passwords, "module_id"), moduleId),
                      eq(col(passwords, "credential_id"), captured.credentialId),
                      eq(col(passwords, "verifier_version"), rehash.expectedVersion),
                      eq(col(passwords, "verifier"), Redacted.value(rehash.expectedVerifier)),
                    ),
                  ),
              );
            }
            return receipt;
          }),
        ),
      readForSubject: (input) =>
        Effect.gen(function* () {
          if (input.moduleId !== moduleId) return Option.none();
          return yield* readSnapshot(db, input.subjectId);
        }).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({}))),
      recoveryTarget: (input) =>
        Effect.gen(function* () {
          if (input.moduleId !== moduleId || input.identifier.namespace !== "email") {
            return Option.none();
          }
          const account = yield* subjectForEmail(db, input.identifier.value);
          if (account === undefined || account.status !== "active") return Option.none();
          const verified = (yield* live(
            db
              .select({ verifiedAt: col(identifiers, "verified_at") })
              .from(identifiers)
              .where(
                and(
                  eq(col(identifiers, "subject_id"), account.id),
                  eq(col(identifiers, "namespace"), "email"),
                ),
              ),
          )) as Array<{ readonly verifiedAt: number | null }>;
          // Identifiers are never verified (no email delivery yet), so there
          // is no recovery target — fail closed, not silent.
          if (verified[0]?.verifiedAt == null) return Option.none();
          return yield* readSnapshot(db, account.id);
        }).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({}))),
      // Every subject has exactly one password, created at signup; adding
      // another is unsupported (mirrors the custom example).
      addIfAbsent: () => Effect.fail(Password.PasswordUnavailable.make({})),
      replaceIfCurrent: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const { authorization } = input;
            const replayed = (yield* live(
              db
                .select({ commandId: col(passwordCommands, "command_id") })
                .from(passwordCommands)
                .where(
                  and(
                    eq(col(passwordCommands, "module_id"), moduleId),
                    eq(col(passwordCommands, "command_id"), input.commandId),
                  ),
                ),
            )) as Array<{ readonly commandId: string }>;
            const current =
              authorization.challenge.action === "change-password" &&
              input.credential !== undefined &&
              (yield* revisionCurrent(db, input.expectedRevision)) &&
              (yield* revisionCurrent(db, authorization.challenge.revision)) &&
              authorization.challenge.moduleId === moduleId &&
              authorization.challenge.commandId === input.commandId &&
              authorization.evidence.bindingDigest === authorization.challenge.bindingDigest &&
              (yield* satisfies(db, authorization.evidence, authorization.requirement));
            if (!current || replayed.length > 0) {
              return prepare("rejected", journal);
            }
            const receipt = prepare("changed", journal);
            yield* replace(
              db,
              input.expectedRevision.subjectId,
              input.credential.credentialId,
              input.replacement,
            );
            yield* recordCommand(
              db,
              input.commandId,
              "change-password",
              authorization.challenge.bindingDigest,
              "changed",
              now,
            );
            return receipt;
          }),
        ),
      checkReset: (input) =>
        proofCompletionCurrent(db, input, nowMillis()).pipe(
          Effect.mapError(() => Password.PasswordUnavailable.make({})),
        ),
      resetWithProof: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const { authorization } = input;
            const replayed = (yield* live(
              db
                .select({ commandId: col(passwordCommands, "command_id") })
                .from(passwordCommands)
                .where(
                  and(
                    eq(col(passwordCommands, "module_id"), moduleId),
                    eq(col(passwordCommands, "command_id"), input.commandId),
                  ),
                ),
            )) as Array<{ readonly commandId: string }>;
            const completionOk = yield* proofCompletionCurrent(
              db,
              input.completion.input,
              now,
            ).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({})));
            const current =
              authorization.challenge.action === "reset-password" &&
              input.completion.input.binding._tag === "Subject" &&
              input.completion.input.binding.revision.subjectId ===
                input.expectedRevision.subjectId &&
              completionOk &&
              input.credential !== undefined &&
              (yield* revisionCurrent(db, input.expectedRevision)) &&
              (yield* revisionCurrent(db, authorization.challenge.revision));
            if (!current || replayed.length > 0) {
              return prepare("rejected", journal);
            }
            const receipt = prepare("changed", journal);
            input.completion.prepare("completed", journal, () => undefined);
            yield* consumeProofCompletion(db, input.completion.input).pipe(
              Effect.mapError(() => Password.PasswordUnavailable.make({})),
            );
            yield* replace(
              db,
              input.expectedRevision.subjectId,
              input.credential.credentialId,
              input.replacement,
            );
            yield* recordCommand(
              db,
              input.commandId,
              "reset-password",
              authorization.challenge.bindingDigest,
              "changed",
              now,
            );
            return receipt;
          }),
        ),
      cleanupAttempts: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const due = (yield* live(
              db
                .select({
                  attemptId: col(passwordAttempts, "attempt_id"),
                  retentionUntil: col(passwordAttempts, "retention_until"),
                })
                .from(passwordAttempts)
                .where(eq(col(passwordAttempts, "module_id"), input.moduleId)),
            )) as Array<{ readonly attemptId: string; readonly retentionUntil: number }>;
            const removable = due.filter((row) => row.retentionUntil <= now);
            const batch = removable.slice(0, input.limit);
            for (const row of batch) {
              yield* live(
                db
                  .delete(passwordAttempts)
                  .where(
                    and(
                      eq(col(passwordAttempts, "module_id"), input.moduleId),
                      eq(col(passwordAttempts, "attempt_id"), row.attemptId),
                    ),
                  ),
              );
            }
            return prepare(
              { removed: batch.length, hasMore: removable.length > batch.length },
              journal,
            );
          }),
        ),
    });

    return Context.make(Password.PasswordPersistence, persistence).pipe(
      Context.add(AppAuth.strategies.password.RegistrationAuthority, {
        register: (input, prepare) =>
          withCommit((journal) =>
            Effect.gen(function* () {
              if (input.moduleId !== moduleId || input.identifier.namespace !== "email") {
                return yield* Password.PasswordUnavailable.make({});
              }
              // A public request ID never adopts an old subject or replaces
              // its password: replay and duplicate both suppress.
              const replays = (yield* live(
                db
                  .select({ requestId: col(passwordRegistrations, "request_id") })
                  .from(passwordRegistrations)
                  .where(
                    and(
                      eq(col(passwordRegistrations, "module_id"), moduleId),
                      eq(col(passwordRegistrations, "request_id"), input.requestId),
                    ),
                  ),
              )) as Array<{ readonly requestId: string }>;
              const existing = yield* subjectForEmail(db, input.identifier.value);
              if (replays.length > 0 || (existing !== undefined && existing.status === "active")) {
                return prepare({ _tag: "Suppressed" }, journal);
              }
              const email = yield* live(
                Schema.decodeEffect(AuthSchema.Email)(input.identifier.value),
              );
              const subjectId = yield* provisioning.password({
                identifier: input.identifier,
                registration: input.registration,
              });
              void email;
              const credentialId = credentialIdFor(subjectId);
              const credentialRevision = newId();
              const identifierRevision = newId();
              const receipt = prepare({ _tag: "Created", subjectId }, journal);
              yield* live(
                db.insert(identifiers).values({
                  namespace: "email",
                  value: input.identifier.value,
                  subjectId,
                  revision: identifierRevision,
                  verifiedAt: null,
                  active: 1,
                }),
              );
              yield* live(
                db.insert(credentials).values({
                  credentialId,
                  subjectId,
                  revision: credentialRevision,
                  active: 1,
                }),
              );
              yield* live(
                db.insert(passwords).values({
                  moduleId,
                  subjectId,
                  credentialId,
                  credentialRevision,
                  verifierVersion: newId(),
                  verifier: Redacted.value(input.replacement.verifier),
                  normalization: input.replacement.normalization,
                }),
              );
              yield* live(
                db.insert(passwordRegistrations).values({ moduleId, requestId: input.requestId }),
              );
              return receipt;
            }),
          ),
      }),
    );
  }),
).pipe(Layer.provideMerge(hooksLayer));
