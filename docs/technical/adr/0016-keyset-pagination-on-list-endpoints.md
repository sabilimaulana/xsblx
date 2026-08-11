---
status: accepted
version: 1.0.0
updated: 2026-08-11
---

# 0016 — Keyset pagination on list endpoints

## Context

`GET /todos` returned every row a user owned. That is fine while a user has
twenty todos and wrong at every scale above it: response size, memory and query
time all grow with the account, and nothing in the API's shape signals a limit —
so a client cannot page even if it wants to. This repo is a scaffold, so the
list endpoint is copied; whatever shape it has becomes the shape of every list
endpoint written after it.

Two ways to bound it:

- **Offset/limit.** `LIMIT 20 OFFSET 980` makes Postgres walk and discard 980
  rows to return 20 — cost grows linearly with page depth. Worse, an insert
  between two requests shifts every subsequent offset, so a client paging
  forwards sees a row twice or misses one entirely.
- **Keyset (cursor).** `WHERE id < $cursor ORDER BY id DESC LIMIT 20` seeks
  directly into the index and reads exactly one page, at the same cost for page
  1 and page 500. Concurrent inserts land above the cursor and never disturb
  pages already read.

Keyset's cost is that it cannot jump to an arbitrary page number, because the
cursor is a position and not a count. Nothing here needs numbered pages.

## Decision

List endpoints are paginated by keyset, and the page schema is part of the API
definition rather than a convention:

- Query params are declared as a field record on the endpoint
  (`TodoListQuery` in `packages/api/src/features/todos/schema.ts`), so
  `HttpApiEndpoint` derives the string parsing from the decoded types and
  OpenAPI documents the params.
- The page size default (20) and the hard cap (100) live in that schema, which
  makes an unbounded request a decode failure rather than a large response.
- The cursor is the id of the last row on the previous page. Ordering is `id`
  descending, which for a monotonic identity column is also newest-first.
- The response is `TodoPage { items, nextCursor }`. `nextCursor` is `null` on
  the last page. Clients follow it; they never compute an offset. The service
  learns whether a next page exists by selecting `limit + 1` rows, so there is
  no second `COUNT` query.
- The index carries the whole access path: `(userId, id DESC)`. Filters that are
  not part of it — `completed` for the `status` param — are residual, evaluated
  over the rows one page's seek already touched.

## Consequences

- No "page 7" and no total count. Adding either means a `COUNT(*)` per request
  or a separate estimate; neither is free and neither is currently needed.
- The cursor exposes row ids. That is already true of every other endpoint here
  (`/todos/:id`), and ids are per-owner unreachable (ADR 0007). If ids ever have
  to be opaque, the cursor becomes an encoded token and `TodoPage` changes shape.
- Ordering is welded to `id`. Sorting a list by anything else needs a composite
  cursor (`(sortValue, id)`) and a matching index — a new ADR, not a tweak.
- Every list endpoint added later inherits this. A list endpoint without a page
  schema is the wrong shape, not an omission.
- The old `todos_userId_idx` is dropped, not kept alongside — `(userId, id DESC)`
  serves every query the single-column index did.
