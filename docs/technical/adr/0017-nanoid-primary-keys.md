---
status: accepted
version: 1.0.0
updated: 2026-08-12
---

# 0017 — 21-character nanoid primary keys

## Context

`todos.id` was a Postgres identity column and Better Auth minted its own ids with
its bundled generator. Two id schemes, one of them a small integer.

A serial integer id is a poor public identifier. It is guessable, so a client can
walk the key space; the API answers `TodoNotFound` for another user's row (ADR 0007) and so leaks nothing directly, but the row count leaks from any id the
caller does own. It also cannot be minted before the insert, which rules out
client-generated ids and idempotent writes later on.

The obvious replacement is UUIDv4: 36 characters, hyphens, and a shape that says
nothing about which table it belongs to. `effect` already pulls `uuid` in
transitively, so it was available for free.

## Decision

Every generated id in the system is a 21-character nanoid over
`0-9A-Za-z` — nanoid's URL alphabet with `-` and `_` removed. 62^21 ≈ 2^125,
which is UUIDv4's collision domain in 21 characters instead of 36.

`-` and `_` are excluded because ids travel in path segments, query strings, CSV
exports and log greps, and a leading `-` reads as a flag to enough tools that the
two bits are not worth it.

- The alphabet, the length and the `IdString` schema live in
  `packages/api/src/id.ts` — the API package is the contract, and the web app
  validates against the same rule.
- The generator lives in `apps/server/src/id.ts`. Both the Effect services (via
  drizzle's `$defaultFn`) and Better Auth (via `advanced.database.generateId`)
  call it, so it is infrastructure and not a feature slice.
- `nanoid` is pinned at `6.0.1`. The server image resolves without the lockfile
  (ADR 0014), so an inexact range is not safe here.

A nanoid carries no ordering, which ADR 0016's keyset pagination depended on.
The sort key for `GET /todos` is therefore `(createdAt, id)`: `createdAt` orders,
`id` breaks ties within a millisecond, and the cursor carries both as
`<ISO>|<id>`. `todos.createdAt` is declared at millisecond precision so a stored
value cannot sort after its own cursor, which would repeat the last row of every
page.

## Consequences

- Ids are 21 bytes of text rather than 4 bytes of integer. The `todos` primary
  key index grows accordingly, and inserts are random rather than append-only, so
  the index sees page splits a monotonic key would not. At this scale that is
  noise; if it stops being noise the answer is a time-sortable id (UUIDv7,
  ULID), not a return to serials.
- The cursor is an opaque string a client must round-trip verbatim. A cursor
  minted before this change no longer decodes, and the schema rejects it rather
  than silently paging from the start.
- The tie-break is only correct while `createdAt` and the cursor agree on
  precision. Widening the column past milliseconds without widening the cursor
  format reintroduces duplicate rows at page boundaries.
- Row ordering within one millisecond is by id, which is random. A test cannot
  assert that a page comes back in insertion order — it can only assert that
  paging visits the unpaged list once.
- Reversing this means a migration back to identity columns and a new id for
  every existing row; nothing outside the database holds these ids yet, so the
  cost is one migration, not a coordination problem.
