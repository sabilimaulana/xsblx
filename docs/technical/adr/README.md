---
status: active
version: 1.0.0
updated: 2026-08-10
---

# Architecture Decision Records

Append-only. One decision per file, `NNNN-<slug>.md`. Never edit a decision in
substance and never delete one — write a new ADR that supersedes it, and set the
old one to `status: superseded` with `superseded-by:`. Numbers are never reused.

Write an ADR when a choice is expensive to reverse: a dependency, a data model, a
boundary, a pinned version, or a deliberate non-adoption.

Do **not** write an ADR for a standing constraint on how work is done — that
belongs in `AGENTS.md`. Test: can a later decision supersede it? → ADR. Is it a
rule you obey on every edit? → `AGENTS.md`.

| #    | Decision                                                                                                   | Status   |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Shared schemas live in `packages/api`](./0001-shared-schemas-in-packages-api.md)                          | accepted |
| 0002 | [Effect pinned to 4.0.0-beta.103](./0002-pin-effect-beta-103.md)                                           | accepted |
| 0003 | [Services own SQL and domain errors](./0003-services-own-sql-and-domain-errors.md)                         | accepted |
| 0004 | [Tests hit real Postgres](./0004-tests-hit-real-postgres.md)                                               | accepted |
| 0005 | [Feature-first slices](./0005-feature-first-slices.md)                                                     | accepted |
| 0006 | [Exactly one workspace depends on `vite`](./0006-exactly-one-vite-dependent.md)                            | accepted |
| 0007 | [Better Auth runs outside Effect](./0007-better-auth-outside-effect.md)                                    | accepted |
| 0008 | [Two origins, CORS with credentials](./0008-two-origins-cors-with-credentials.md)                          | accepted |
| 0009 | [Effect Schema is the only validator](./0009-effect-schema-is-the-only-validator.md)                       | accepted |
| 0010 | [TanStack Query owns server reads](./0010-tanstack-query-owns-server-reads.md)                             | accepted |
| 0011 | [shadcn registry before hand-written primitives](./0011-shadcn-registry-before-hand-written-primitives.md) | accepted |
| 0012 | [Vendored repos are reference, not dependencies](./0012-vendored-repos-as-reference-not-dependencies.md)   | accepted |
| 0013 | [Nitro serves the web production build](./0013-nitro-serves-the-web-build.md)                              | accepted |
| 0014 | [One Dockerfile, one compose file](./0014-one-dockerfile-one-compose-file.md)                              | accepted |

Template:

```markdown
---
status: proposed | accepted | superseded
version: 1.0.0
updated: YYYY-MM-DD
---

# NNNN — Title

## Context

What forced a choice.

## Decision

What we do, present tense.

## Consequences

What this costs, and what has to change if we reverse it.
```
