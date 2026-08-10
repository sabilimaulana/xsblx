---
status: active
version: 1.0.0
updated: 2026-08-10
---

# PRD template

Copy to `prd-NNN-<slug>.md`. Delete sections that do not apply — an honest short
PRD beats a padded one.

---

# PRD NNN — <title>

**Status:** draft | approved | shipped | dropped
**Owner:**
**Updated:**

## Problem

What breaks today, for whom, how often.

## Goal

One sentence. What is true after this ships that is not true now.

## Non-goals

## User stories

- As a <role>, I can <action>, so that <outcome>.

## Behaviour

The rules, including the unhappy paths: empty states, conflicts, permission
denials, validation failures. Each rule here should map to a domain error in
`packages/api/src/features/<feature>/errors.ts` — if a rule has no error to
land on, either the rule is vague or the error is missing.

## Out of scope for v1

## Implementation steps

The build order, split so that **one step is one commit**. An agent picks up the
next unchecked step, does only that, and commits — no step may depend on a later
one, and no step may leave the repo failing `typecheck`, `lint` or the test suite.

Each step states:

- **Goal** — one sentence, what is true after this commit.
- **Touches** — the files it is allowed to change. A step reaching outside its
  list is a sign the split is wrong; re-split rather than widen.
- **Done when** — the observable check, machine-checkable: a test name, a
  command, or a UI action. "It compiles" is not a check.
- **Commit** — the Conventional Commits subject to use.

Rules for the split:

- Follow the slice order: drizzle table and migration, then domain schema and
  errors in `packages/api`, then the `HttpApiGroup`, then the service, then the
  handler, then the UI. Server before web, always — the web cannot be built
  against an endpoint that does not exist.
- A migration is its own step. Never bundled with the code that reads the new
  column.
- Every step that adds non-trivial logic adds or extends a test in the same
  commit. Tests are not a trailing step.
- Every step that establishes a repeatable pattern codifies its guardrail in the
  same commit: a lint rule, a tsgo severity, or an `AGENTS.md` line. A convention
  only a human can enforce is a bug waiting for a reader.
- If a step turns out to need a decision nobody has made, stop and write the ADR
  first — that is its own step too.

```markdown
### Step N — <title>

- [ ] **Goal:**
      **Touches:** `path`, `path`
      **Done when:**
      **Commit:** `feat(scope): subject`
```

## Success

Metric + threshold.

## Open questions
