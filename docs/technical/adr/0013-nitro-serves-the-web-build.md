---
status: superseded
version: 1.0.0
updated: 2026-08-10
superseded-by: ./0019-cloudflare-deploy-through-alchemy.md
---

# 0013 — Nitro serves the web production build

## Context

`vite build` with `tanstackStart()` alone emits `dist/server/server.js` plus
`dist/client/assets/`. That server renders routes but does not serve the client
assets — it assumes a CDN or reverse proxy in front of it. Running
`bun dist/server/server.js` therefore returned a 200 HTML document in which every
`/assets/*` URL 404'd: the stylesheet, the router chunk, every component chunk.
The page loaded unstyled and dead, with no server-side error to point at.

The alternatives were to put a static file server in front (another moving part
to configure per environment) or to adopt the deployment layer TanStack Start is
built around.

## Decision

`apps/web` builds through Nitro: `nitro()` from `nitro/vite` sits after
`tanstackStart()` in the plugin list. Output moves from `dist/` to `.output/`,
and `bun run start` runs `.output/server/index.mjs`, which serves both SSR and
the static assets.

`nitro` is pinned to the published beta `3.0.260610-beta`, not the
`nitro@npm:nitro-nightly` alias the docs suggest. The nightly package imports
`nitro` from inside its own files, and under bun's resolution the alias cannot
see itself — the config fails to load with `Cannot find package 'nitro'`.

## Consequences

- `.output/` is the deploy artefact. Already gitignored, along with `.nitro`.
- Nitro presets are how this app reaches a specific host (Vercel, Node, a
  container). No preset is configured; the default Node output is what
  `bun run start` runs.
- Nitro pulls in `h3`/`srvx` as the server runtime. It does not add a second
  `vite` dependent, so ADR 0006 still holds — verify with
  `ls node_modules/.bun | grep '^vite@'` after any bump.
- `nitro/vite` is under active development. A bump can break the build; bump it
  deliberately and re-check that `/assets/*` still returns 200.
