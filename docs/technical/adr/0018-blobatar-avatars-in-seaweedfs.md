---
status: accepted
version: 1.0.0
updated: 2026-08-20
---

# 0018 — Generated avatars stored as SVG in SeaweedFS

## Context

`user.image` existed and was always `null`: Better Auth declares the column and
nothing ever wrote to it. Every account rendered as an email address.

An avatar has to come from somewhere, and there are only three places:

- **A third party.** Gravatar (or an avatar CDN) means hashing the user's email
  and handing it to someone else's server on every page load, and an account
  with no Gravatar falls back to a placeholder anyway.
- **The client.** A React component renders the avatar from the user id. Nothing
  is stored and nothing is uploaded, but the avatar exists only where that
  component runs — an email, an OpenGraph card, an admin export or a second
  client each need the generator again.
- **The server, into storage.** The avatar becomes a URL like any other asset,
  and everything that can render an `<img>` can render it.

The repo had `S3_*` variables in `.env.example` and an unused `S3Config` in
`apps/server/src/config.ts` — a decision half-made and never written down.

[`blobatar`](https://github.com/Alain00/blobatar) generates a deterministic
geometric SVG from any string, with no dependencies, and returns markup as a
string — usable on a server with no DOM and no rasteriser.

## Decision

**Registration writes a randomly seeded blobatar SVG to the object store and
persists its URL in `user.image`.**

- **The store is SeaweedFS**, one container running master, volume, filer and S3
  gateway, addressed through its S3 API. It is not in a compose profile: `bun
dev` on the host needs it the way it needs Postgres.
- **The bucket is `xsblx`, and the prefix carries the access rule.**
  `public/*` is readable by an unsigned request; everything else — `private/*`
  included — requires a signature. That is what makes an avatar URL work in a
  plain `<img src>` with no proxy route and no presigning.
- **The seed is a fresh `newId()`, not the user id or email.** The avatar is
  random per registration rather than derived, so the same address registered
  twice does not inherit the same face and the URL reveals nothing about its
  owner. The key is that same id: `public/avatars/<id>.svg`.
- **Uploads go through Bun's own `S3Client`**, no AWS SDK. Avatar generation
  lives in `apps/server/src/features/auth/avatar.ts` and runs in Better Auth's
  `databaseHooks.user.create.before`, outside the Effect runtime with the rest of
  auth (ADR 0007) — so it reads `process.env` directly, and `S3Config` was
  deleted rather than left as a service nothing could be given.
- **A failed upload leaves `image` null and logs a warning.** Signing up is not
  held hostage to a decorative asset.
- **The S3 identity file is written by the seaweedfs entrypoint from `.env`.**
  Credentials stay in one place and are never committed, and there is no second
  config file to keep in step with compose.

## Consequences

- **The anonymous grant needs a trailing `*`.** SeaweedFS compares an action
  without a wildcard for equality against `<Action>:<bucket>` only, so
  `Read:xsblx/public` grants nothing at all — silently, as a 403 on a URL that
  looks right. It is `Read:xsblx/public/*`.
- **Creating the bucket is a separate step.** `PutObject` to a missing bucket is
  a 404 and the S3 API cannot create one under a non-admin identity, so a
  one-shot `seaweedfs-init` service runs `s3.bucket.create` through `weed shell`
  and the server waits for it.
- **Avatar tests run under `bun test`, not vitest.** The module imports `bun`,
  which node cannot resolve, so `*.bun.test.ts` is excluded from the vitest
  include and the server's `test` script runs both. Those tests need the store
  up, the same way the rest need Postgres (ADR 0004).
- **Nothing deletes avatars.** A deleted user leaves its SVG behind — 880 bytes
  per orphan, no lifecycle rule, no sweeper. Recorded as a ceiling in
  `architecture.md`.
- **The stored URL embeds an origin.** `S3_PUBLIC_URL` is what a browser can
  resolve, which is not what the server talks to inside compose. Moving the
  store to another host invalidates every URL already written; the fix then is a
  relative key plus one join at read time, which is a migration, not a shim.
- **Only `public/*` is written today.** `private/*` exists as the closed half of
  the rule — the first upload that must not be world-readable needs no new
  bucket, no new identity and no new decision.
