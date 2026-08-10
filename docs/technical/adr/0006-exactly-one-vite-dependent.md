---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0006 — Exactly one workspace depends on `vite`

## Context

Two workspaces depending on `vite` — even on the same version — make bun install
two peer-variants of it. `@tanstack/start-plugin-core` then resolves a different
copy than the one running the dev server. Its `isRunnableDevEnvironment` check is
an `instanceof`, so it fails, the SSR middleware is silently never installed, and
**every route 404s with `Cannot GET /`**. No error, no warning, nothing in the
logs pointing at dependency resolution.

`apps/server` wanted vite only for `loadEnv` in `vitest.config.ts`.

## Decision

Only `apps/web` may depend on `vite`. `apps/server/vitest.config.ts` reads
`apps/server/.env` with `process.loadEnvFile` instead.

## Consequences

- Any workspace needing a vite utility gets a non-vite equivalent instead, or
  the code moves to `apps/web`.
- Diagnosing the symptom: `ls node_modules/.bun | grep '^vite@'`. More than one
  entry is the bug.
- The failure is silent, so this cannot be caught by a type-check or a lint. It
  is enforced by review and by AGENTS.md.
