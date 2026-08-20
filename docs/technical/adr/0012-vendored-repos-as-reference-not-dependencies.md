---
status: accepted
version: 1.0.0
updated: 2026-08-10
amended-by: ./0019-cloudflare-deploy-through-alchemy.md
---

# 0012 — Vendored repos are read-only reference; alchemy and effect-machine are non-adoptions

## Context

Effect 4 is beta. Published docs lag the API, and an agent asked to write Effect
code without the source will produce plausible calls against the wrong version —
which is worse than failing, because it type-checks against nothing. Having the
exact runtime's source on disk removes the guessing.

That argues for vendoring, which then raises the opposite risk: source sitting in
the tree looks importable, and a large reference codebase looks like a
recommendation.

## Decision

External repositories are vendored under `repos/` at pinned tags by
`scripts/vendor.sh`, which documents its own usage and holds the tags.

- `repos/` is gitignored and must never be committed — ~142M of third-party
  source belongs in nobody's history. Missing on a fresh clone is expected; run
  the script.
- Read-only. Do not edit files under `repos/` unless explicitly asked.
- Never import from `repos/`. Application code imports from normal package
  dependencies.
- Prefer patterns from vendored source over generated guesses or web search.
- `repos/effect/` is the API source of truth. Read `repos/effect/LLMS.md` before
  writing Effect code.

Two vendored repos are **deliberate non-adoptions**:

- `repos/alchemy/` is vendored only because it is a large, real-world Effect 4
  codebase — useful for seeing how service/layer composition, error taxonomies,
  resource lifecycles, `Schema` at boundaries, concurrency and retry get put
  together in production. It is not part of this stack and will not be. Do not
  propose it, install it, or write Alchemy resources here.
- `repos/effect-machine/` is reference material for state-machine patterns if a
  task ever calls for one. Not a dependency.

`repos/effect-query/` is different: `effect-query` is a real dependency of
`apps/web` (ADR 0010), and the vendored copy is its reference source.

## Consequences

- A fresh clone needs one command before an agent has its reference material.
- Bumping a pinned version means editing the tag in `scripts/vendor.sh` and
  re-running it. For `effect` that is part of the larger bump in ADR 0002.
- `scripts/vendor.sh` is the single source of truth for pinned versions. Nothing
  else lists them.
