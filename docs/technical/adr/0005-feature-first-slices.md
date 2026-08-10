---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0005 — Feature-first slices, the layer is the filename

## Context

Layer-first trees (`services/`, `handlers/`, `schemas/`, `routes/`) scatter one
feature across every directory in the repo. Adding a feature touches five
directories; deleting one means finding every file that mentions it, and the ones
that are missed become dead code. The cost grows with the number of features,
which is the direction this repo goes.

## Decision

Code is feature-first. One feature is one directory in each package, and the
layer is the file name inside it, not a directory above it:

```
packages/api/src/features/<feature>/{todo,errors,group}.ts
apps/server/src/features/<feature>/{schema,service,http,service.test}.ts
```

Adding a feature adds a directory plus two import lines
(`packages/api/src/api.ts` and `apps/server/src/index.ts`). Deleting one is
`rm -rf` plus removing those two lines.

`todos` is the worked reference slice, DB → HTTP → UI. New features copy its
shape; a feature that cannot must say why before diverging.

Two things stay central and are not feature-folded:

- `apps/server/src/db/schema.ts` is a barrel re-exporting every
  `features/*/schema.ts`. drizzle-kit takes a single schema entry, and
  `defineRelations` in `db/relations.ts` needs all tables at once.
- `packages/api/src/api.ts` composes the groups into `Api`. That is its only job.

## Consequences

- A feature's blast radius is one directory per package plus two lines.
- The two central files are edited by every feature change. They stay trivial —
  a barrel and a composition — so that is a merge conflict, not a design problem.
- Cross-feature reuse has no obvious home yet. When a second feature needs a
  first feature's service, it depends on the service interface, not the
  directory.
