import { Schema } from "effect";

/**
 * Auth endpoints belong to Better Auth, not to `Api` — but the credential rules
 * have to agree on both sides, so they live here once: the server feeds
 * `minPasswordLength` to `betterAuth`, and the web forms validate against these.
 */
export const MIN_PASSWORD_LENGTH = 8;

const Email = Schema.String.check(Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/));
const Password = Schema.String.check(Schema.isMinLength(MIN_PASSWORD_LENGTH));

export const SignIn = Schema.Struct({
  email: Email,
  password: Password,
  // The shared form holds a `name` field for both modes; sign-in accepts any
  // value (including the empty default) and ignores it.
  name: Schema.String,
});

export const SignUp = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Email,
  password: Password,
});

export const SignInStandard = Schema.toStandardSchemaV1(SignIn);
export const SignUpStandard = Schema.toStandardSchemaV1(SignUp);
