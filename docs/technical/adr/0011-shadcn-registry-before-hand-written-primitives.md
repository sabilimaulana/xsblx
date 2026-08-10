---
status: accepted
version: 1.0.0
updated: 2026-08-10
---

# 0011 — shadcn registry before hand-written primitives

## Context

Hand-rolled UI primitives are where accessibility quietly dies: focus
management, keyboard interaction, `aria-*` wiring, portal and scroll-lock
behaviour. A hand-written dialog or combobox looks finished and is not. The
registry versions are already solved, and once installed they are ordinary files
in this repo.

## Decision

Before hand-writing any UI primitive, check the registry and install it:

1. Search — `shadcn` MCP server (`search_items_in_registries`) or
   `bunx shadcn@latest search <term>`.
2. Install into the UI package: `bunx shadcn@latest add <name> -c packages/ui`.
3. Only hand-write when the registry has nothing that fits, and say so.

Components install into `packages/ui`, never into an app. Customise by editing
the installed file in `packages/ui/src/components/` — they are ours once
installed. No wrapper layer added purely to change styling.

Composing installed components into an app-specific component is expected and
fine.

## Consequences

- A hand-rolled version of something the registry ships is treated as a bug, not
  a shortcut.
- Upstream updates are not automatic: editing installed files means re-running
  `add` would overwrite local changes. Accepted — ownership is the trade.
- All Tailwind lives in `packages/ui/src/styles/globals.css`; `apps/web` has no
  stylesheet of its own.
