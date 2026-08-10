# Docs

| Path              | Holds                                                  |
| ----------------- | ------------------------------------------------------ |
| `product/`        | What we build and why. PRDs, one per feature.          |
| `technical/`      | How it is built. Architecture, ADRs.                   |
| `technical/adr/`  | Architecture Decision Records — numbered, append-only. |
| `../CHANGELOG.md` | Shipped changes, newest first.                         |

## Versioning

Git is the version control. Do not keep `-v2` copies of a doc.

Every doc carries frontmatter:

```yaml
---
status: draft | active | superseded
version: 0.1.0
updated: 2026-08-10
---
```

Rules:

- `version` bumps on meaning change, not typo fixes. Minor for new sections or
  scope changes, major when the doc's conclusion reverses.
- `updated` is the date of the last meaning change, absolute, never "last week".
- Superseding a doc: set `status: superseded`, add `superseded-by: <path>` to the
  frontmatter, leave the file in place. ADRs are never deleted or edited in
  substance — write a new one that supersedes.
- PRDs are `prd-NNN-<slug>.md`, ADRs `NNNN-<slug>.md`. Numbers are never reused.
- `CHANGELOG.md` carries no frontmatter. It is append-at-top, and says what
  changed — never why. Why goes in an ADR, linked.

## Precedence

`AGENTS.md` (symlinked as `CLAUDE.md`) is the working agreement: rules that must
be obeyed while editing code. Docs here explain and decide.

`AGENTS.md` states a rule in one or two imperative lines and cites the ADR by
number. The ADR holds the context, the reasoning and the cost. Neither restates
the other — if the same paragraph appears in both, one of them is already stale.

When they disagree: `AGENTS.md` wins for code, docs win for intent, and one of
them is wrong. Fix it in the same change.
