---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0014 — One Dockerfile, one compose file, profiles instead of variants

## Context

The repo needed containers: an image per app and Postgres alongside them. Two
questions had answers that are expensive to reverse — how many files describe
the stack, and how the runtime image gets its dependencies.

The obvious layout is a Dockerfile per app plus `compose.yml` and
`compose.prod.yml`. Both apps build from the same bun install and the same
lockfile, so per-app Dockerfiles would duplicate the manifest-copy and install
stages, and the two compose files would differ only in which services run.

The dependency question is bun-specific and cost 250MB. bun 1.3's default
isolated linker extracts _every_ package in the lockfile into a shared store at
the root and symlinks the used ones into each workspace. A runtime image that
copies that store carries drizzle-kit (95MB), rolldown, lightningcss and the
typescript compiler even though the server links none of them. Three of the
obvious escapes do not work:

- `bun install --production` drops only the _root_ `devDependencies`; a
  workspace's own are installed either way.
- `--filter server` narrows what is linked, not what the store holds.
- Dereferencing the symlinks (`cp -RL`) breaks resolution: in the isolated
  layout a package's own dependencies are _siblings_ inside the store entry, so
  copying the link target alone loses them.

## Decision

One `Dockerfile` with `server` and `web` targets, and one `compose.yaml` whose
`app` profile holds everything but Postgres.

- `docker compose up -d` starts Postgres alone — the local loop, with
  `bun dev` on the host.
- `docker compose --profile app up -d --build` runs the whole stack.

The server's runtime dependencies are installed in a stage that first deletes
`bun.lock`, the `apps/web` and `packages/ui` manifests, and the server's
`devDependencies`, then installs with `--linker hoisted`. It then prunes what
only a type-checker or a debugger reads — `*.d.ts`, `*.d.mts`, `*.d.cts`, `*.map`
and the `src/` trees packages ship beside `dist/` — which is two thirds of the
remaining tree. 575MB → 129MB.

Migrations run as a one-shot `migrate` service that the server waits on with
`service_completed_successfully`, executing `apps/server/src/migrate.ts` —
drizzle-orm's own migrator, so the image needs no drizzle-kit.

## Consequences

- Deleting the lockfile means transitive versions float in the server image.
  Every direct server dependency is pinned exactly, so the risk is bounded, and
  the image is a third of the size. Reverting is a one-line change if a
  transitive ever breaks a deploy.
- The prune is safe only while nothing resolves a runtime entry to a raw `.ts`.
  The packages that list one (`better-auth`, `zod`, `@standard-schema/spec`) put
  it behind a `dev-source`-style condition bun never enables, and `@xsblx/api`,
  which does need its sources, is a symlink out of `node_modules` that `find`
  does not follow. A dependency that ships TypeScript as its default entry would
  break at import time, not at build time.
- Every size here is uncompressed, as `docker images` reports it. The registry
  stores layers gzipped, so a pull moves roughly half that — Docker Hub lists the
  bun base at 41MB against the 101MB it occupies once extracted.
- 87MB of the remaining 129MB is the bun binary in the base image, so that is the
  floor for anything running `bun`. Bundling the server with `bun build` to drop
  `node_modules` entirely reaches 104MB but breaks Better Auth — its route table
  does not survive static bundling, and every `/api/auth/*` request 404s. Not
  worth 25MB.
- The web image is the `.output` directory and nothing else (ADR 0013), 104MB.
- `VITE_API_URL` is compiled into the client bundle, so it is a build argument
  on the `web` service, not a runtime variable. Changing the API origin means
  rebuilding.
- Postgres 18 mounts the whole `/var/lib/postgresql`, not `data/` beneath it —
  18+ images refuse to start against a `data`-rooted volume.
- Compose reads the root `.env` (`.env.example` documents it). The apps keep
  their own `.env` files for the host dev loop; nothing is shared between them.
