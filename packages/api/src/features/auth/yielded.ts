import { AuthContract, Password, Schema as AuthSchema, Sessions } from "@yielded/auth";
import { Schema } from "effect";

/**
 * Spike contract for yielded-auth on the `yielded-auth` branch.
 *
 * Password-only: signup (register), sign-in, session. No email verification,
 * no reset delivery, no passkey/OAuth — those are the follow-ups if the spike
 * proves the D1 path. Claims stay `{ displayName, email }` so the web forms
 * and `CurrentUser` do not change shape.
 */
export const minimumPasswordLength = 8;

export const Registration = Schema.Struct({
  displayName: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  email: Schema.String.check(Schema.isMaxLength(320)),
});

export const Claims = Schema.Struct({
  displayName: Schema.String,
  email: AuthSchema.Email,
});

const email = Schema.String.check(Schema.isMaxLength(320)).pipe(Schema.decodeTo(AuthSchema.Email));
const password = Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(4096)));

export const PasswordFailure = Schema.Union([
  Password.PasswordRejected,
  Password.PasswordUnavailable,
  Password.PasswordActionRequired,
  Password.PasswordMethodUnsupported,
  Password.NewPasswordRejected,
  Password.PasswordCheckUnavailable,
]);

export const RegisterInput = Schema.Struct({
  requestId: Password.PasswordCommandId,
  email,
  newPassword: password,
  registration: Registration,
});

export const RegisterResult = Schema.Union([
  Schema.TaggedStruct("RegistrationAccepted", {}),
  Schema.TaggedStruct("ProvisioningPending", { reference: Schema.String }),
]);

type Completion =
  | { readonly _tag: "Authenticated"; readonly session: { readonly subjectId: string } }
  | { readonly _tag: "PendingAuthentication" };

// Reuse the actions with the caller's session schemas.
export const accountActions = <
  Session extends Schema.Codec<unknown, unknown, unknown, unknown>,
  Result extends Schema.Codec<Completion, unknown, unknown, unknown>,
>(sessions: {
  readonly Session: Session;
  readonly CompletionResult: Result;
}) => ({
  passwordSignIn: AuthContract.passwordSignIn(sessions, { strategy: "password" }),
  register: AuthContract.action({
    payload: RegisterInput,
    success: RegisterResult,
    error: PasswordFailure,
    mode: "mutation",
    replay: "idempotent",
    strategy: "password",
  }),
});

export const XsblxAuthApi = AuthContract.make("xsblx", {
  claims: Claims,
  basePath: "/api/auth",
  actions: accountActions,
});

export const sessionConfiguration = Sessions.stateful();

export type SessionClaims = typeof Claims.Type;
