---
status: accepted
version: 1.0.0
updated: 2026-09-04
supersedes:
  - ./0002-pin-effect-beta-103.md
---

# 0027 — Effect, drizzle and alchemy move as one rc version set

## Context

ADR 0002 pinned effect to `4.0.0-beta.103` for one concrete reason: every
published `drizzle-orm@1.0.0-rc.*` build called `Schema.TaggedErrorClass`, which
effect beta.104 renamed to `Schema.TaggedError`. On beta.104+ importing a drizzle
effect driver threw `Schema.TaggedErrorClass is not a function` at import time,
before any application code ran. beta.103 was the highest version where both
libraries worked. 0002 named its own exit: **"revisit only when drizzle publishes
a build against beta.104+."**

Drizzle published it. `drizzle-orm@1.0.0-rc.5-ab785fc` contains zero
`TaggedErrorClass` call sites and twenty `Schema.TaggedError` ones, and peers
`effect: >=4.0.0-beta.105 || >=4.0.0`. The condition is met exactly as written.

What makes this one change rather than three is alchemy. PR 1444 (ADR 0026) is
built against a manifest that pins its peers hard:

```
effect        >=4.0.0-rc.112 || >=4.0.0
drizzle-orm   1.0.0-rc.5-ab785fc
drizzle-kit   1.0.0-rc.5-ab785fc
```

Not a range on the drizzle side — the exact build. So "upgrade effect", "upgrade
drizzle" and "adopt `Cloudflare.Telemetry`" are not three decisions that happen
to land together; they are one version set with no valid intermediate. Any two of
the three, without the third, is an unsatisfiable install.

Two properties of this set are worth recording, because both look like mistakes:

- **The drizzle version carries a commit suffix.** There is no plain
  `1.0.0-rc.5` on npm. The `rc5` branch publishes commit-tagged builds only, and
  the `rc5` dist-tag points at `1.0.0-rc.5-169397b` for `drizzle-orm` but
  `1.0.0-rc.5-ab785fc` for `drizzle-kit` — two different commits under one tag.
  `ab785fc` is the pair alchemy pins and the only sha published for both
  packages.
- **The alchemy version is a URL, not a version.** PR 1444 merged on
  `2026-09-02`; the newest release, `2.0.0-beta.76`, is from `2026-08-31`. No tag
  contains it. The repo's PR-package workflow publishes per-commit builds to
  pkg.ing, and `@alchemy.run/better-auth` at that commit peers `alchemy` at the
  same URL, so the pair is self-consistent.

## Decision

**One catalog bump moves the whole set, and `scripts/vendor.sh` moves with it.**

- **`catalog:effect` → `4.0.0-rc.112`**, covering `effect`, `@effect/sql-d1`,
  `@effect/platform-bun`, `@effect/platform-node` and `@effect/vitest`.
  `@effect/tsgo` → `0.40.0` in the same change; it is not in a catalog but it is
  in the set.
- **`drizzle-orm` and `drizzle-kit` → `1.0.0-rc.5-ab785fc`**, the exact build
  alchemy peers on, in the root catalog.
- **`alchemy` and `@alchemy.run/better-auth` → the pkg.ing build of merge commit
  `e05c734ea30625efd07a443cef267bfde225f5b4`.** The merge commit on `main`, not
  the PR head — it carries everything else that landed since beta.76.
- **`repos/effect` and `repos/alchemy` are re-vendored to match** — the tag
  `effect@4.0.0-rc.112` and that commit sha. ADR 0012's rule that vendored source
  is the API source of truth at the exact installed version is unchanged; the
  script gains a sha path because a commit is not a tag.
- **ADR 0002's standing rule survives its own supersession**: never bump one
  member of the set alone, and bump through the root catalogs rather than in a
  workspace. Only the versions changed.

## Consequences

- **`Schema.TaggedErrorClass` is now `Schema.TaggedError`** at all three call
  sites, and `Schema.ErrorClass`, `Schema.ErrorReviver` are `Schema.Error`,
  `Schema.ErrorInstanceReviver` should they ever appear. This is the rename
  0002 existed to avoid, applied.
- **`bun install` reaches pkg.ing, not only the npm registry.** A third host on
  the install path, and the build behind that URL is a CI artifact rather than a
  published release. The exit is mechanical: when a release contains PR 1444,
  the URL becomes a version and `catalog:alchemy` goes back to a semver string.
  Nothing else in the set changes.
- **`effect-query@1.0.0`'s peer range is satisfied now.** It asks for
  `^4.0.0-beta.23`, which `4.0.0-rc.112` meets — ADR 0002's note about installing
  against a mismatched range no longer applies.
- **`@better-auth/drizzle-adapter` needed no coordination.** It peers
  `drizzle-orm: ^0.45.2 || >=1.0.0-rc.1 <2.0.0`, which the pinned build
  satisfies.
- **Two rc dependencies now gate each other.** An effect rc.113 that drizzle
  rc5 or alchemy@1444 has not been built against is not installable, and the
  same is true in reverse. This is the same shape of constraint ADR 0002
  recorded, at a higher version.
- **Drizzle rc5 makes `undefined` in a relational-query filter throw**, with a
  new `EmptyFilter` symbol as the explicit opt-in. Nothing here uses relational
  query filters — the keyset predicate composes with `and()`, which still drops
  `undefined` operands — but a future RQB caller must not pass `undefined`
  through.
