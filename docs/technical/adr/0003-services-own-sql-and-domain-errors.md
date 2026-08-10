---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0003 — Services own SQL and return domain errors only

## Context

A service that leaks `SqlError` into its error channel forces every caller —
handler, test, another service — to handle a failure it cannot do anything
about. A dropped connection is not an outcome the domain has an answer for; it is
a bug or an outage. Meanwhile a handler that reads rows directly ends up holding
business rules, and the row type spreads outward until the persistence shape is
the domain shape.

## Decision

A feature's `service.ts` is a `Context.Service` + `Layer` that owns the business
rules and all SQL for that feature. It fails with domain errors only: one
`Schema.TaggedErrorClass` per case, wrapped in a single per-domain error holding
them in `reason`. Infrastructure failures are `Effect.orDie`.

Row types never escape the service — a `toDomain` function converts at the
boundary.

Handlers (`http.ts`) translate HTTP ↔ domain and nothing else: they call the
service and map its error reasons onto the endpoint's declared errors. An
unexpected reason is `Effect.die`, which surfaces as a 500.

## Consequences

- Domain error channels stay short enough to read in a signature.
- An infrastructure failure is a 500 with a logged defect, not a silently
  handled branch.
- Adding an error case means adding it in `errors.ts`, the group's declared
  errors, and the handler's mapping — three places, all compile-checked.
- Business logic is testable without HTTP: the tests target the service (ADR
  0004).
