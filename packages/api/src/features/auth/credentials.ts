import { Schema } from "effect";

/**
 * Auth endpoints belong to Better Auth, not to `Api` — but the credential rules
 * have to agree on both sides, so they live here once: the server feeds
 * `minPasswordLength` to `betterAuth`, and the web forms validate against these.
 */
export const MIN_PASSWORD_LENGTH = 8;

// The `message` annotation is what the form renders on failure; without it the
// default formatter falls back to the filter's `expected` text.
const Email = Schema.String.check(
  Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, {
    message: "Enter a valid email address",
  }),
);
const Password = Schema.String.check(
  Schema.isMinLength(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  }),
);
const Name = Schema.String.check(Schema.isMinLength(1, { message: "Name is required" }));

export const SignIn = Schema.Struct({
  email: Email,
  password: Password,
  // The shared form holds a `name` field for both modes; sign-in accepts any
  // value (including the empty default) and ignores it.
  name: Schema.String,
});

export const SignUp = Schema.Struct({
  name: Name,
  email: Email,
  password: Password,
});

export const SignInStandard = Schema.toStandardSchemaV1(SignIn);
export const SignUpStandard = Schema.toStandardSchemaV1(SignUp);
