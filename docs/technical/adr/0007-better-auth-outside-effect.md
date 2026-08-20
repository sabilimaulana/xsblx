---
status: accepted
version: 1.0.0
updated: 2026-08-10
amended-by: ./0022-better-auth-as-a-service-on-d1.md
---

# 0007 — Better Auth runs outside Effect, and owns its own HTTP contract

## Context

Effect is required for application code. Better Auth is a plain async library
that owns a large HTTP surface and generates the client's types from the server
instance. Wrapping it in a `Context.Service` would mean re-declaring every route
in `packages/api`, re-deriving types the library already derives, and keeping the
two in sync by hand — a full second contract maintained for the sake of
uniformity.

## Decision

Better Auth is used as-is, outside the Effect runtime, and does not follow the
feature slice (ADR 0005):

- `apps/server/src/features/auth/auth.ts` — `betterAuth(...)` + `drizzleAdapter`,
  with its own `drizzle-orm/bun-sql` connection.
- `apps/server/src/features/auth/http.ts` — a raw `HttpRouter` route mounted at
  `/api/auth/*`, passing the web `Response` through untouched.
- `apps/web/src/lib/auth-client.ts` — `createAuthClient` from `better-auth/react`.

Auth routes are **not** in `packages/api`. Everything else still goes through
`Api` and the `effect-query` bridge.

The rules that must not be simplified away:

- The raw route passes the `Response` through untouched. Flattening its headers
  merges multiple `set-cookie` values into one broken cookie.
- Credential rules live once, in `packages/api/src/features/auth/credentials.ts`.
  The server passes `minPasswordLength`; the forms validate against the same
  Standard Schemas (ADR 0009).
- The API is closed, not just the UI. `TodosApiGroup` carries
  `.middleware(Authentication)`, implemented by resolving the session cookie
  through `auth.api.getSession`. It provides `CurrentUser`; handlers take the
  owner id from there and never from a payload. `Todos` filters every query by
  `userId`, and another user's row surfaces as `TodoNotFound`, not a 403 — a 403
  would confirm the row exists.

`auth.ts`, `features/auth/schema.ts` and `lib/auth-client.ts` are exempted from
`processEnv` / `globalDate` / `asyncFunction` in `tsconfig.effect.json`: they are
the code that legitimately runs outside Effect.

## Consequences

- Two contract styles in one server. Contained: it is one directory and one
  mounted route.
- Auth's HTTP shape is not compile-checked against the web the way `Api` is. The
  generated client types cover it instead.
- Regenerating the auth tables is a manual procedure — see
  [architecture.md](../architecture.md#regenerating-the-auth-tables).
- The `Authentication` middleware contract does live in `packages/api`
  (`features/auth/middleware.ts`), because endpoint groups reference it.
