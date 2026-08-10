---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0009 — Effect Schema is the only validator

## Context

A form library with its own validation layer creates a second place where "what
is valid" is written down. The two drift, and the failure is asymmetric: the form
accepts something the API rejects, so the user sees a 400 from a form that told
them it was fine.

`Schema` already describes every payload the API accepts (ADR 0001), and exports
to Standard Schema V1, which TanStack Form consumes directly.

## Decision

Effect `Schema` is the only validation library. No zod, no yup, no
`react-hook-form` resolvers. Forms are TanStack Form (`@tanstack/react-form`) with
the shadcn `field` primitives, validating against the API's own schema exported as
a Standard Schema:

```ts
// packages/api/src/features/todos/todo.ts
export const TodoCreateStandard = Schema.toStandardSchemaV1(TodoCreate);
```

A component never restates a validation rule.

## Consequences

- Changing a rule is one edit in `packages/api`, and both sides move together.
- Client-side-only rules (confirm-password matching, for example) have no home in
  the API schema and are written as form-level validators. Those are UI
  invariants, not domain rules.
- If a form and the API can disagree about what is valid, that is a bug, not a
  configuration.
