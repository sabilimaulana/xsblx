---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0010 — TanStack Query owns server reads; no loaders, no atom library

## Context

Three candidates could own server data in `apps/web`: TanStack Router loaders,
TanStack Query, or an Effect-native binding like `@effect-atom/atom-react`. Two
owners for the same state means two caches, two invalidation stories, and a
question with no answer whenever they disagree.

Router loaders additionally serialize their result. The router throws on class
instances, and every domain type here is a `Schema.Class` — so a loader carrying
server data would have to flatten and re-hydrate at the boundary.

`@effect-atom/atom-react` is not installed. Request/response is exactly what
TanStack Query models, and adding a second async-state library to get Effect
ergonomics buys nothing that the `effect-query` bridge does not already provide.

## Decision

| State                 | Owner                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Server data (reads)   | TanStack Query `useQuery`, `queryClient.invalidateQueries` on write  |
| Form state            | TanStack Form (ADR 0009)                                            |
| Effect → React bridge | `eq` + `api` in `apps/web/src/lib/api-client.ts` (`effect-query`)    |

`createEffectQueryFromManagedRuntime` turns an Effect into
`queryOptions` / `mutationOptions`; `api((client) => …)` supplies `ApiClient`.
Failures stay typed: `error.match({ TodoNotFound: …, OrElse: … })`.

`QueryClient` is created once at module scope in `__root.tsx`. Route loaders are
not used for server data at all.

Every query-backed route sets `ssr: false`, because the session cookie exists
only in the browser (ADR 0007) — an SSR pass would call the API unauthenticated
and get a 401.

## Consequences

- No per-request cache, because there is no per-request server render of
  query-backed routes. Acceptable: those routes are authenticated and personal.
- Nothing crosses the loader serialization boundary, so `Schema.Class` instances
  and `DateTime.Utc` stay inside the client. Still prefer
  `Schema.DateFromString` over `Schema.DateTimeUtc` on anything the web reads.
- Reach for `@effect-atom/atom-react` only for push state a query cannot model —
  an Effect `Stream` rendered live, like upload or transcode progress. Adding it
  for request/response would reintroduce the second owner this ADR exists to
  prevent.
