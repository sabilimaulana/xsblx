---
status: accepted
version: 1.0.0
updated: 2026-10-06
supersedes:
  - ./0007-better-auth-outside-effect.md
  - ./0022-better-auth-as-a-service-on-d1.md
amends:
  - ./0024-custom-domains-make-the-session-cookie-first-party.md
---

# 0030 — yielded-auth replaces Better Auth

## Context

Better Auth was the one part of the stack outside Effect (ADR 0007), and on a
Worker it had to be rebuilt as a per-isolate service around bindings that only
exist during a request (ADR 0022). Its routes were not in `packages/api`, its
client was a separate React hook library, and its types came from the server
instance rather than from a shared schema.

[yielded-auth](https://yielded.dev/auth/) is an Effect-native auth library: its
contract is a schema (`AuthContract`) that both sides import, its server is a set
of Effect services and layers, and its browser client is an Effect service. From
`0.1.0-beta.23` its core depends only on Effect and its own `@yielded/crypto`,
`@yielded/jose` and `@yielded/oauth`.

A spike on the `yielded-auth` branch proved the server path on Workers + D1:
register, sign-in, session verification on the app `Api`, sign-out with
revocation, and a D1-backed attempt limiter. Two gaps were found and are part of
this decision:

- **yielded's SQL kernels cannot run on Workers.** They build interactive
  transactions and validate storage with live queries at layer build; D1 has
  neither at init. The app implements yielded's persistence contracts itself
  (`yielded-*-ports.ts`) on D1. Where a contract needs several rows to commit
  together, they go in one D1 `batch`, which is atomic; a single-row
  compare-and-swap is a guarded `UPDATE … RETURNING`.
- **yielded's session cookie accepts `SameSite` `lax` or `strict` only.** There
  is no `none`.

## Decision

**yielded-auth owns authentication. Better Auth is removed.**

- **The contract lives in `packages/api`** (`features/auth/yielded.ts`), as ADR
  0001 already requires of every other contract. The server mounts it with
  `Http.make`; the web builds its client from the same value with
  `Client.make`. Auth is no longer the exception to the shared-schema rule.
- **The web reaches auth through the same runtime as the `Api` client.** The
  yielded client is a service in `apps/web/src/lib/api-client.ts`, so TanStack
  Query owns session reads exactly as it owns every other read (ADR 0010).
- **The subject is the `user` row** (`id`, `displayName`, `status`,
  `securityRevision`). The login email lives only in yielded's identifiers
  table. There is no avatar and no `image` column.
- **Keys are two secrets, `AUTH_PROOF_KEY` and `AUTH_BINDING_KEY`**, replacing
  `AUTH_SECRET`. `API_PUBLIC_ORIGIN` declares the API's own origin, which
  yielded needs at layer build.
- **Password attempts are limited in D1**, not in isolate memory, so the budget
  holds across isolates.

**Amends ADR 0024's `SESSION_COOKIE_SAMESITE` clause.** The cookie is always
`SameSite=Lax`, and the variable is removed. A stage whose website signs users in
must put both Workers under one registrable domain (`WEB_DOMAIN` / `API_DOMAIN`).
A stage left on `workers.dev` still serves the API, but a browser on its website
cannot hold a session — which ADR 0024 already called one browser default away
from broken.

## Consequences

- The `yielded-*-ports.ts` files are ours to maintain against yielded's
  persistence contracts. A yielded release that changes those contracts is a code
  change here, not a version bump. If yielded ships a D1 composition that builds
  without I/O, the ports are deleted in favour of it.
- yielded is pre-1.0 (`beta`). Its versions are pinned exactly.
- Argon2id runs in JavaScript (`@yielded/crypto/Portable`): a password
  sign-in or registration costs ~2–3s on a Worker. Tuning the hash cost is a
  later decision.
- Email delivery, password change/reset and key rotation are not built. Delivery
  fails closed.
- Reversing this means restoring ADR 0022's service, its four tables, and a
  `none`-capable cookie.
