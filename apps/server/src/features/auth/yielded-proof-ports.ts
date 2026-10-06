import { Proofs } from "@yielded/auth";
import { coordinateCommit, LifecycleHooks } from "@yielded/auth/Hooks";
import { hooksLayer } from "@yielded/auth/Persistence";
import { Schema } from "effect";
import { and, eq } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer } from "effect";

import { Db } from "../../db/index.ts";
import { newId } from "../../id.ts";
import { AppAuth } from "./yielded-auth.ts";
import { user } from "./schema.ts";
import { nowMillis } from "./yielded-support.ts";
import {
  identifiers,
  passwords,
  proofAbuse,
  proofContinuations,
  proofFailures,
  proofGenerations,
  proofRequests,
} from "./yielded-tables.ts";

/**
 * Hand-written D1 proof ports.
 *
 * Same story as the password/session ports: sequential D1 statements, pure
 * layer build, `coordinateCommit` around mutating methods. Logic mirrors
 * upstream's custom-store example (series/active/supersede lifecycle,
 * abuse budgets, continuationconsume, delivery claims).
 *
 * Two deliberate simplifications, both fail-closed:
 * - Per-proof policy is NOT stored (the generations table has no policy
 *   column); the policy arriving with each call is used. Policy is static
 *   app config, so stored and arriving values are the same object.
 * - The continuations `version` column is written as `"1"`: nothing in the
 *   app reads it (completion checks proof state, not continuation
 *   version), and kernels never read tables except through these ports.
 *
 * Reset-address reality: only `${password}/reset` + `password-reset` is a
 * supported module/purpose, and `bindingCurrent` requires a *verified*
 * identifier for it — identifiers are never verified (no email delivery),
 * so every reset proof suppresses, every reset attempt rejects, and every
 * reset completion is stale. Reset fails closed at the proof layer on top
 * of the fail-closed delivery and denied action evidence.
 */

const pwdModule = AppAuth.strategies.password.persistence.moduleId;

/** Column accessor by database column name; throws loudly on drift (see password ports). */
const col = (table: SQLiteTable, name: string): AnyColumn => {
  const found = getTableConfig(table).columns.find((column) => column.name === name);
  if (found === undefined) {
    throw new Error(`[yielded-auth] table has no column ${name}`);
  }
  return found as AnyColumn;
};

const live = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, Proofs.ProofUnavailable> =>
  Effect.mapError(effect, () => Proofs.ProofUnavailable.make({}));

const bindingJson = Schema.encodeSync(Schema.fromJsonString(Proofs.ProofBinding));
const decodeBinding = Schema.decodeSync(Schema.fromJsonString(Proofs.ProofBinding));
const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(Proofs.ProofRequestReceipt));
const decodeReceipt = Schema.decodeSync(Schema.fromJsonString(Proofs.ProofRequestReceipt));

const sameBinding = (a: Proofs.ProofBinding, b: Proofs.ProofBinding): boolean =>
  bindingJson(a) === bindingJson(b);

const seriesKey = (moduleId: string, purpose: string, binding: Proofs.ProofBinding): string =>
  JSON.stringify([moduleId, purpose, binding.identifier.namespace, binding.identifier.value]);

const supported = (moduleId: string, purpose: string): boolean =>
  moduleId === `${pwdModule}/reset` && purpose === "password-reset";

interface AbuseBudget {
  readonly kind: string;
  readonly key: string;
  readonly limit: number;
  readonly windowMillis: number;
}

/** Budgets mirror the custom example; scope rows are derived, never stored. */
const budgets = (
  moduleId: string,
  purpose: string,
  binding: Proofs.ProofBinding,
  action: "issue" | "attempt",
  // The policy shape is static app config; only the used fields are read.
  policy: {
    readonly abuse: {
      readonly actionIssues: { readonly limit: number; readonly windowMillis: number };
      readonly actionAttempts: { readonly limit: number; readonly windowMillis: number };
      readonly issues: { readonly limit: number; readonly windowMillis: number };
      readonly attempts: { readonly limit: number; readonly windowMillis: number };
      readonly subjectIssues: { readonly limit: number; readonly windowMillis: number };
      readonly subjectAttempts: { readonly limit: number; readonly windowMillis: number };
    };
  },
): Array<AbuseBudget> => {
  const key = JSON.stringify(["proof", moduleId, purpose, action]);
  const window = action === "issue" ? policy.abuse.actionIssues : policy.abuse.actionAttempts;
  const scoped = action === "issue" ? policy.abuse.issues : policy.abuse.attempts;
  const subject = action === "issue" ? policy.abuse.subjectIssues : policy.abuse.subjectAttempts;
  return [
    { kind: "action", key: `${key}/action`, ...window },
    {
      kind: "identifier",
      key: `${key}/${JSON.stringify([binding.identifier.namespace, binding.identifier.value])}`,
      ...scoped,
    },
    ...(binding._tag === "Identifier"
      ? []
      : [{ kind: "subject", key: `${key}/subject/${binding.revision.subjectId}`, ...subject }]),
  ];
};

/** Charge every open bucket; the caller decides admission from the result. */
const chargeAbuse = Effect.fn("YieldedD1.chargeAbuse")(function* (
  db: Db["Service"],
  moduleId: string,
  purpose: string,
  action: "issue" | "attempt",
  commandId: string,
  scopes: ReadonlyArray<AbuseBudget>,
  now: number,
) {
  const open: Array<AbuseBudget> = [];
  for (const scope of scopes) {
    const recent = (yield* live(
      db
        .select({ occurredAt: col(proofAbuse, "occurred_at") })
        .from(proofAbuse)
        .where(
          and(
            eq(col(proofAbuse, "module_id"), moduleId),
            eq(col(proofAbuse, "action"), action),
            eq(col(proofAbuse, "scope_kind"), scope.kind),
            eq(col(proofAbuse, "scope_key"), scope.key),
          ),
        ),
    )) as Array<{ readonly occurredAt: number }>;
    if (recent.filter((row) => row.occurredAt >= now - scope.windowMillis).length < scope.limit) {
      open.push(scope);
    }
  }
  for (const scope of open) {
    yield* live(
      db.insert(proofAbuse).values({
        moduleId,
        purpose,
        action,
        scopeKind: scope.kind,
        scopeKey: scope.key,
        commandId,
        occurredAt: now,
        retentionUntil: now + scope.windowMillis,
      }),
    );
  }
  return open.length === scopes.length;
});

/** A Subject binding is current when the user/credentials still match. */
const bindingCurrent = Effect.fn("YieldedD1.bindingCurrent")(function* (
  db: Db["Service"],
  binding: Proofs.ProofBinding,
  purpose: string,
) {
  if (binding.identifier.namespace !== "email") return false;
  const idRows = (yield* live(
    db
      .select({ subjectId: col(identifiers, "subject_id") })
      .from(identifiers)
      .where(
        and(
          eq(col(identifiers, "namespace"), "email"),
          eq(col(identifiers, "value"), binding.identifier.value),
          eq(col(identifiers, "active"), 1),
        ),
      ),
  )) as Array<{ readonly subjectId: string }>;
  const subjectId = idRows[0]?.subjectId;
  const users =
    subjectId === undefined
      ? []
      : yield* live(db.select().from(user).where(eq(user.id, subjectId)));
  const owner = users.find((row) => row.status === "active");
  if (binding._tag === "Identifier") return owner === undefined;
  if (owner === undefined || owner.id !== binding.revision.subjectId) return false;
  if (
    owner.securityRevision !== binding.revision.securityRevision ||
    !binding.revision.credentials.every((item) => item.credentialId.length > 0)
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
        and(eq(col(passwords, "module_id"), pwdModule), eq(col(passwords, "subject_id"), owner.id)),
      ),
  )) as Array<{ readonly credentialId: string; readonly credentialRevision: string }>;
  if (
    !binding.revision.credentials.every((item) =>
      pwRows.some(
        (actual) =>
          actual.credentialId === item.credentialId && actual.credentialRevision === item.revision,
      ),
    )
  ) {
    return false;
  }
  const verified = (yield* live(
    db
      .select({ verifiedAt: col(identifiers, "verified_at") })
      .from(identifiers)
      .where(
        and(
          eq(col(identifiers, "subject_id"), owner.id),
          eq(col(identifiers, "namespace"), "email"),
        ),
      ),
  )) as Array<{ readonly verifiedAt: number | null }>;
  const isVerified = (verified[0]?.verifiedAt ?? null) !== null;
  return purpose === "password-reset" ? isVerified : !isVerified;
});

interface ContinuationRow {
  readonly digest: string;
  readonly binding: string;
  readonly expiresAt: number;
  readonly consumed: number;
  readonly purpose: string;
  readonly proofId: string;
}

const readContinuation = Effect.fn("YieldedD1.readContinuation")(function* (
  db: Db["Service"],
  moduleId: string,
  continuationId: string,
) {
  const rows = (yield* live(
    db
      .select({
        digest: col(proofContinuations, "digest"),
        binding: col(proofContinuations, "binding"),
        expiresAt: col(proofContinuations, "expires_at"),
        consumed: col(proofContinuations, "consumed"),
        purpose: col(proofContinuations, "purpose"),
        proofId: col(proofContinuations, "proof_id"),
      })
      .from(proofContinuations)
      .where(
        and(
          eq(col(proofContinuations, "module_id"), moduleId),
          eq(col(proofContinuations, "continuation_id"), continuationId),
        ),
      ),
  )) as Array<ContinuationRow>;
  return rows[0];
});

const readGenerationState = Effect.fn("YieldedD1.readGenerationState")(function* (
  db: Db["Service"],
  moduleId: string,
  proofId: string,
) {
  const rows = (yield* live(
    db
      .select({ state: col(proofGenerations, "state") })
      .from(proofGenerations)
      .where(
        and(
          eq(col(proofGenerations, "module_id"), moduleId),
          eq(col(proofGenerations, "proof_id"), proofId),
        ),
      ),
  )) as Array<{ readonly state: string }>;
  return rows[0]?.state;
});

/**
 * Shared with the password ports (`checkReset`/`resetWithProof`): a proof
 * completion is current when the continuation is live and its proof was
 * consumed by a verified attempt.
 */
export const proofCompletionCurrent = Effect.fn("YieldedD1.proofCompletionCurrent")(function* (
  db: Db["Service"],
  input: Proofs.ProofCompletionInput,
  now: number,
) {
  if (!supported(input.moduleId, input.purpose)) return false;
  if (!(yield* bindingCurrent(db, input.binding, input.purpose))) return false;
  const row = yield* readContinuation(db, input.moduleId, String(input.continuationId));
  if (
    row === undefined ||
    row.consumed !== 0 ||
    row.expiresAt <= now ||
    row.purpose !== input.purpose ||
    row.digest !== String(input.continuationDigest) ||
    !sameBinding(decodeBinding(row.binding), input.binding)
  ) {
    return false;
  }
  return (yield* readGenerationState(db, input.moduleId, row.proofId)) === "consumed";
});

export const consumeProofCompletion = Effect.fn("YieldedD1.consumeProofCompletion")(function* (
  db: Db["Service"],
  input: Proofs.ProofCompletionInput,
) {
  yield* live(
    db
      .update(proofContinuations)
      .set({ consumed: 1 })
      .where(
        and(
          eq(col(proofContinuations, "module_id"), input.moduleId),
          eq(col(proofContinuations, "continuation_id"), String(input.continuationId)),
        ),
      ),
  );
});

interface GenerationRow {
  readonly proofId: string;
  readonly seriesKey: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly version: string;
  readonly state: string;
  readonly sendCount: number;
  readonly deliveryState: string;
  readonly retryAt: number | null;
  readonly deliveryRetryMillis: number;
  readonly binding: string;
  readonly verifierKeyId: string;
  readonly verifierDigest: string;
  readonly deliveryId: string;
  readonly claimVersion: string | null;
  readonly claimDeadline: number | null;
}

const readGeneration = Effect.fn("YieldedD1.readGeneration")(function* (
  db: Db["Service"],
  moduleId: string,
  proofId: string,
) {
  const rows = (yield* live(
    db
      .select({
        proofId: col(proofGenerations, "proof_id"),
        seriesKey: col(proofGenerations, "series_key"),
        issuedAt: col(proofGenerations, "issued_at"),
        expiresAt: col(proofGenerations, "expires_at"),
        version: col(proofGenerations, "version"),
        state: col(proofGenerations, "state"),
        sendCount: col(proofGenerations, "send_count"),
        deliveryState: col(proofGenerations, "delivery_state"),
        retryAt: col(proofGenerations, "retry_at"),
        deliveryRetryMillis: col(proofGenerations, "delivery_retry_millis"),
        binding: col(proofGenerations, "binding"),
        verifierKeyId: col(proofGenerations, "verifier_key_id"),
        verifierDigest: col(proofGenerations, "verifier_digest"),
        deliveryId: col(proofGenerations, "delivery_id"),
        claimVersion: col(proofGenerations, "claim_version"),
        claimDeadline: col(proofGenerations, "claim_deadline"),
      })
      .from(proofGenerations)
      .where(
        and(
          eq(col(proofGenerations, "module_id"), moduleId),
          eq(col(proofGenerations, "proof_id"), proofId),
        ),
      ),
  )) as Array<GenerationRow>;
  return rows[0];
});

export const ProofPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* Db;
    const hooks = yield* LifecycleHooks;

    const withCommit = <A, E, R>(
      owner: (
        journal: Parameters<Parameters<typeof coordinateCommit>[0]>[0],
      ) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | Proofs.ProofUnavailable, R> =>
      coordinateCommit(owner, { mode: "synchronous" }).pipe(
        Effect.map((result) => result.value),
        Effect.catchTag("HookConfigurationError", () => Proofs.ProofUnavailable.make({})),
        Effect.provideService(LifecycleHooks, hooks),
      );

    const persistence = Proofs.ProofPersistence.of({
      issue: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const { record, policy } = input;
            if (!supported(record.moduleId, record.purpose)) {
              return yield* Proofs.ProofUnavailable.make({});
            }
            const previous = (yield* live(
              db
                .select({
                  fingerprint: col(proofRequests, "fingerprint"),
                  receipt: col(proofRequests, "receipt"),
                  retentionUntil: col(proofRequests, "retention_until"),
                })
                .from(proofRequests)
                .where(
                  and(
                    eq(col(proofRequests, "module_id"), record.moduleId),
                    eq(col(proofRequests, "request_id"), String(record.requestId)),
                  ),
                ),
            )) as Array<{
              readonly fingerprint: string;
              readonly receipt: string;
              readonly retentionUntil: number;
            }>;
            const livePrevious = previous.find((row) => row.retentionUntil > now);
            if (livePrevious !== undefined) {
              if (livePrevious.fingerprint !== String(record.fingerprint)) {
                return yield* Proofs.ProofRequestConflict.make({});
              }
              return prepare(
                {
                  _tag: "Existing",
                  receipt: decodeReceipt(livePrevious.receipt),
                },
                journal,
              );
            }
            const receipt = {
              requestId: record.requestId,
              reference: {
                proofId: record.proofId,
                purpose: record.purpose,
                keyId: record.verifier.keyId,
              },
            };
            yield* live(
              db.insert(proofRequests).values({
                moduleId: record.moduleId,
                requestId: String(record.requestId),
                fingerprint: String(record.fingerprint),
                proofId: String(record.proofId),
                purpose: record.purpose,
                keyId: record.verifier.keyId,
                createdAt: now,
                retentionUntil: now + policy.requestRetentionMillis,
                receipt: encodeReceipt(receipt),
              }),
            );
            const series = seriesKey(record.moduleId, record.purpose, record.binding);
            const seriesRows = (yield* live(
              db
                .select({
                  proofId: col(proofGenerations, "proof_id"),
                  issuedAt: col(proofGenerations, "issued_at"),
                })
                .from(proofGenerations)
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), record.moduleId),
                    eq(col(proofGenerations, "series_key"), series),
                  ),
                ),
            )) as Array<{ readonly proofId: string; readonly issuedAt: number }>;
            const activeState = (yield* live(
              db
                .select({
                  proofId: col(proofGenerations, "proof_id"),
                  binding: col(proofGenerations, "binding"),
                  state: col(proofGenerations, "state"),
                })
                .from(proofGenerations)
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), record.moduleId),
                    eq(col(proofGenerations, "series_key"), series),
                    eq(col(proofGenerations, "state"), "active"),
                  ),
                ),
            )) as Array<{
              readonly proofId: string;
              readonly binding: string;
              readonly state: string;
            }>;
            const current = activeState[0];
            const recent = seriesRows.some(
              (row) => row.issuedAt > now - policy.abuse.resendCooldownMillis,
            );
            const admitted = yield* chargeAbuse(
              db,
              record.moduleId,
              record.purpose,
              "issue",
              String(record.requestId),
              budgets(record.moduleId, record.purpose, record.binding, "issue", policy),
              now,
            );
            const collides = (yield* live(
              db
                .select({ proofId: col(proofGenerations, "proof_id") })
                .from(proofGenerations)
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), record.moduleId),
                    eq(col(proofGenerations, "proof_id"), String(record.proofId)),
                  ),
                ),
            )) as Array<{ readonly proofId: string }>;
            if (
              !admitted ||
              recent ||
              !input.eligible ||
              !(yield* bindingCurrent(db, record.binding, record.purpose)) ||
              record.expiresAtMillis <= now ||
              record.expiresAtMillis > now + policy.lifetimeMillis ||
              collides.length > 0 ||
              (input.supersedes !== undefined &&
                (current?.proofId !== String(input.supersedes) ||
                  (current !== undefined &&
                    !sameBinding(decodeBinding(current.binding), record.binding))))
            ) {
              return prepare({ _tag: "Suppressed", receipt }, journal);
            }
            const fresh = {
              ...record,
              issuedAtMillis: now,
              expiresAtMillis: Math.min(record.expiresAtMillis, now + policy.lifetimeMillis),
            };
            const result = prepare({ _tag: "Issued", record: fresh }, journal);
            if (current !== undefined) {
              yield* live(
                db
                  .update(proofGenerations)
                  .set({ state: "superseded" })
                  .where(
                    and(
                      eq(col(proofGenerations, "module_id"), record.moduleId),
                      eq(col(proofGenerations, "proof_id"), current.proofId),
                    ),
                  ),
              );
            }
            yield* live(
              db.insert(proofGenerations).values({
                moduleId: record.moduleId,
                purpose: record.purpose,
                proofId: String(record.proofId),
                requestId: String(record.requestId),
                seriesKey: series,
                deliveryId: String(record.deliveryId),
                binding: bindingJson(record.binding),
                verifierKeyId: record.verifier.keyId,
                verifierDigest: String(record.verifier.digest),
                issuedAt: fresh.issuedAtMillis,
                expiresAt: fresh.expiresAtMillis,
                version: String(record.version),
                state: "active",
                sendCount: 0,
                deliveryState: "new",
                claimVersion: null,
                claimDeadline: null,
                retryAt: null,
                deliveryRetryMillis: policy.deliveryRetryMillis,
                retentionUntil: now + policy.requestRetentionMillis,
                fingerprint: String(record.fingerprint),
              }),
            );
            return result;
          }),
        ),
      attempt: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            if (!supported(input.moduleId, input.purpose)) {
              return yield* Proofs.ProofUnavailable.make({});
            }
            const row = yield* readGeneration(db, input.moduleId, String(input.proofId));
            const policy = input.policy;
            const series = seriesKey(input.moduleId, input.purpose, input.binding);
            const failures = (yield* live(
              db
                .select({ occurredAt: col(proofFailures, "occurred_at") })
                .from(proofFailures)
                .where(
                  and(
                    eq(col(proofFailures, "module_id"), input.moduleId),
                    eq(col(proofFailures, "series_key"), series),
                  ),
                ),
            )) as Array<{ readonly occurredAt: number }>;
            const recentFailures = failures.filter(
              (failure) => failure.occurredAt >= now - policy.abuse.attempts.windowMillis,
            ).length;
            const admitted = yield* chargeAbuse(
              db,
              input.moduleId,
              input.purpose,
              "attempt",
              String(input.continuationId),
              budgets(input.moduleId, input.purpose, input.binding, "attempt", policy),
              now,
            );
            const collisions = (yield* live(
              db
                .select({ continuationId: col(proofContinuations, "continuation_id") })
                .from(proofContinuations)
                .where(eq(col(proofContinuations, "module_id"), input.moduleId)),
            )) as Array<{ readonly continuationId: string }>;
            const digestCollisions = (yield* live(
              db
                .select({ digest: col(proofContinuations, "digest") })
                .from(proofContinuations)
                .where(
                  and(
                    eq(col(proofContinuations, "module_id"), input.moduleId),
                    eq(col(proofContinuations, "digest"), String(input.continuationDigest)),
                  ),
                ),
            )) as Array<{ readonly digest: string }>;
            const valid =
              admitted &&
              recentFailures < policy.maximumFailedAttempts &&
              row !== undefined &&
              row.state === "active" &&
              row.seriesKey === series &&
              row.expiresAt > now &&
              sameBinding(decodeBinding(row.binding), input.binding) &&
              (yield* bindingCurrent(db, input.binding, input.purpose)) &&
              input.candidate?.keyId === row.verifierKeyId &&
              String(input.candidate.digest) === row.verifierDigest &&
              !collisions.some((item) => item.continuationId === String(input.continuationId)) &&
              digestCollisions.length === 0;
            if (!valid || row === undefined) {
              yield* chargeAbuse(
                db,
                input.moduleId,
                input.purpose,
                "attempt",
                String(input.continuationId),
                [
                  {
                    kind: "failure",
                    key: `proof-failure/${series}`,
                    limit: policy.maximumFailedAttempts,
                    windowMillis: policy.abuse.attempts.windowMillis,
                  },
                ],
                now,
              );
              yield* live(
                db.insert(proofFailures).values({
                  moduleId: input.moduleId,
                  purpose: input.purpose,
                  seriesKey: series,
                  commandId: String(input.continuationId),
                  occurredAt: now,
                  retentionUntil: now + policy.abuse.attempts.windowMillis,
                }),
              );
              return prepare({ _tag: "Rejected" }, journal);
            }
            const expiresAt = Math.min(row.expiresAt, now + policy.continuationLifetimeMillis);
            const receipt = prepare(
              {
                _tag: "Accepted",
                continuation: {
                  continuationId: input.continuationId,
                  purpose: input.purpose,
                  expiresAtMillis: expiresAt,
                },
              },
              journal,
            );
            yield* live(
              db
                .update(proofGenerations)
                .set({ state: "consumed" })
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), input.moduleId),
                    eq(col(proofGenerations, "proof_id"), row.proofId),
                  ),
                ),
            );
            yield* live(
              db.insert(proofContinuations).values({
                moduleId: input.moduleId,
                purpose: input.purpose,
                continuationId: String(input.continuationId),
                digest: String(input.continuationDigest),
                proofId: row.proofId,
                seriesKey: series,
                binding: bindingJson(input.binding),
                expiresAt,
                consumed: 0,
                version: "1",
                retentionUntil: now + policy.requestRetentionMillis,
              }),
            );
            return receipt;
          }),
        ),
      complete: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const accepted = yield* proofCompletionCurrent(db, input, nowMillis());
            const receipt = prepare(accepted ? "completed" : "rejected", journal);
            if (accepted) {
              yield* consumeProofCompletion(db, input);
            }
            return receipt;
          }),
        ),
      claimDelivery: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const row = yield* readGeneration(db, input.moduleId, String(input.proofId));
            if (row === undefined) {
              return prepare({ _tag: "Declined" }, journal);
            }
            let current = row;
            if (row.deliveryState === "claimed" && (row.claimDeadline ?? 0) <= now) {
              yield* live(
                db
                  .update(proofGenerations)
                  .set({ deliveryState: "ambiguous" })
                  .where(
                    and(
                      eq(col(proofGenerations, "module_id"), input.moduleId),
                      eq(col(proofGenerations, "proof_id"), row.proofId),
                    ),
                  ),
              );
              current = { ...row, deliveryState: "ambiguous" };
            }
            if (
              current.state !== "active" ||
              current.expiresAt <= now ||
              current.version !== String(input.version) ||
              current.deliveryId !== String(input.deliveryId) ||
              current.sendCount >= input.policy.maximumDeliveryAttempts ||
              !(
                current.deliveryState === "new" ||
                (current.deliveryState === "ambiguous" &&
                  input.allowAmbiguousRetry &&
                  (current.retryAt ?? 0) <= now)
              )
            ) {
              return prepare({ _tag: "Declined" }, journal);
            }
            const claimVersion = Proofs.ProofVersion.make(newId());
            const receipt = prepare({ _tag: "Claimed", claimVersion }, journal);
            yield* live(
              db
                .update(proofGenerations)
                .set({
                  deliveryState: "claimed",
                  claimVersion,
                  sendCount: current.sendCount + 1,
                  claimDeadline: now + input.policy.deliveryClaimMillis,
                  retryAt: now + current.deliveryRetryMillis,
                })
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), input.moduleId),
                    eq(col(proofGenerations, "proof_id"), row.proofId),
                  ),
                ),
            );
            return receipt;
          }),
        ),
      settleDelivery: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            const receipt = prepare(undefined, journal);
            const row = yield* readGeneration(db, input.moduleId, String(input.proofId));
            if (
              row === undefined ||
              row.version !== String(input.version) ||
              row.deliveryId !== String(input.deliveryId) ||
              row.claimVersion !== String(input.claimVersion) ||
              row.deliveryState !== "claimed"
            ) {
              return receipt;
            }
            yield* live(
              db
                .update(proofGenerations)
                .set({
                  deliveryState:
                    input.outcome._tag === "Accepted"
                      ? "accepted"
                      : input.outcome._tag === "DefiniteFailure"
                        ? "failed"
                        : "ambiguous",
                  ...(input.outcome._tag === "DefiniteFailure" && row.state === "active"
                    ? { state: "cancelled" as const }
                    : {}),
                  retryAt: now + row.deliveryRetryMillis,
                })
                .where(
                  and(
                    eq(col(proofGenerations, "module_id"), input.moduleId),
                    eq(col(proofGenerations, "proof_id"), row.proofId),
                  ),
                ),
            );
            return receipt;
          }),
        ),
      cancel: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const receipt = prepare(undefined, journal);
            if (yield* bindingCurrent(db, input.binding, input.purpose)) {
              const actives = (yield* live(
                db
                  .select({
                    proofId: col(proofGenerations, "proof_id"),
                    binding: col(proofGenerations, "binding"),
                  })
                  .from(proofGenerations)
                  .where(
                    and(
                      eq(col(proofGenerations, "module_id"), input.moduleId),
                      eq(col(proofGenerations, "state"), "active"),
                    ),
                  ),
              )) as Array<{ readonly proofId: string; readonly binding: string }>;
              for (const item of actives) {
                if (sameBinding(decodeBinding(item.binding), input.binding)) {
                  yield* live(
                    db
                      .update(proofGenerations)
                      .set({ state: "cancelled" })
                      .where(
                        and(
                          eq(col(proofGenerations, "module_id"), input.moduleId),
                          eq(col(proofGenerations, "proof_id"), item.proofId),
                        ),
                      ),
                  );
                }
              }
            }
            return receipt;
          }),
        ),
      cleanup: (input, prepare) =>
        withCommit((journal) =>
          Effect.gen(function* () {
            const now = nowMillis();
            let removed = 0;
            let exhausted = false;
            // Identity columns per table for expired-row deletes, each paired
            // with its select alias (db names are snake_case, aliases camel).
            const targets = [
              {
                table: proofGenerations,
                identity: [{ column: "proof_id", alias: "proofId" }] as const,
                extra: { proofId: col(proofGenerations, "proof_id") },
              },
              {
                table: proofContinuations,
                identity: [{ column: "continuation_id", alias: "continuationId" }] as const,
                extra: { continuationId: col(proofContinuations, "continuation_id") },
              },
              {
                table: proofRequests,
                identity: [{ column: "request_id", alias: "requestId" }] as const,
                extra: { requestId: col(proofRequests, "request_id") },
              },
              {
                table: proofFailures,
                identity: [
                  { column: "series_key", alias: "seriesKey" },
                  { column: "command_id", alias: "commandId" },
                ] as const,
                extra: {
                  seriesKey: col(proofFailures, "series_key"),
                  commandId: col(proofFailures, "command_id"),
                },
              },
              {
                table: proofAbuse,
                identity: [
                  { column: "action", alias: "action" },
                  { column: "scope_kind", alias: "scopeKind" },
                  { column: "scope_key", alias: "scopeKey" },
                  { column: "command_id", alias: "commandId" },
                ] as const,
                extra: {
                  action: col(proofAbuse, "action"),
                  scopeKind: col(proofAbuse, "scope_kind"),
                  scopeKey: col(proofAbuse, "scope_key"),
                  commandId: col(proofAbuse, "command_id"),
                },
              },
            ] as const;
            for (const target of targets) {
              if (removed >= input.limit) {
                exhausted = true;
                break;
              }
              const due = (yield* live(
                db
                  .select({
                    retentionUntil: col(target.table, "retention_until"),
                    ...target.extra,
                  })
                  .from(target.table)
                  .where(eq(col(target.table, "module_id"), input.moduleId)),
              )) as Array<Record<string, string | number | null>>;
              const expired = due.filter(
                (row) =>
                  typeof row["retentionUntil"] === "number" &&
                  (row["retentionUntil"] as number) <= now,
              );
              for (const row of expired.slice(0, input.limit - removed)) {
                const conditions = target.identity.map(({ column, alias }) =>
                  eq(col(target.table, column), String(row[alias] ?? "")),
                );
                yield* live(
                  db
                    .delete(target.table)
                    .where(and(eq(col(target.table, "module_id"), input.moduleId), ...conditions)),
                );
                removed += 1;
              }
              if (expired.length > input.limit - removed && removed >= input.limit) {
                exhausted = true;
              }
            }
            return prepare({ removed, hasMore: exhausted }, journal);
          }),
        ),
    });

    return Context.make(Proofs.ProofPersistence, persistence);
  }),
).pipe(Layer.provideMerge(hooksLayer));
