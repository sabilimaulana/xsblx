---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0008 — Two origins, CORS with credentials

## Context

The web runs on 3001 and the API on 3000. Every read and write is a browser
request from one origin to the other, and the session cookie must ride along.

## Decision

`apps/server/src/index.ts` applies `HttpMiddleware.cors` with
`credentials: true`, and the web client provides `FetchHttpClient.RequestInit`
with `credentials: "include"`. Allowed origins come from
`CORS_ALLOWED_ORIGINS`, never a wildcard — a wildcard is invalid with
credentials anyway.

The allow-list of headers must include `traceparent` and `b3`: Effect's
`HttpClient` sends them for tracing, and omitting them fails the preflight, not
the request — so the symptom is every call dying at `OPTIONS`.

## Consequences

- Adding a deployment origin is an env change, not a code change.
- Any new request header the client starts sending must be added to the
  allow-list or the preflight breaks silently.
- A single-origin reverse proxy would delete this whole surface. Not done: it
  costs a proxy in dev, and two ports is currently free.
