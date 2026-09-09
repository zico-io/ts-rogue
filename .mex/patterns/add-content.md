---
name: add-content
description: Add game content via the src/data tables (monster, item, dungeon, quest).
triggers:
  - "add monster"
  - "add item"
  - "new content"
  - "tile"
edges:
  - target: context/engine.md
    condition: for how data definitions feed combat/loot state
grounds_to: []
last_updated: 2026-09-09
---

# Add content (data table)

## Context

Static content lives in `src/data` (`monsters.ts`, items, `dungeons.ts`,
`quests.ts`, `classes`, affixes, loot tables). The engine reads these; it never
hardcodes content. Content is drawn as ASCII (`MonsterDef.ascii`) - the browser
runs the same Ink renderer over a PTY, so there is one art path, not two.

## Steps

1. **Data:** add/extend the definition in the matching `src/data/*.ts` table.
   A monster carries `ascii` and `color`, plus `skills` and drops. It flows
   into `BattleEnemy` via `src/engine/combat/resolution.ts` automatically.
2. Add a vitest test if the content introduces new behavior (a new skill, drop
   rule, etc.).

## Gotchas

- Colors come from `src/ui/theme.ts` tokens, not raw hex.
- `MonsterDef.sprite` is a leftover from the deleted PixiJS renderer. Nothing
  draws it; do not add new ones.

## Verify

- `pnpm test:unit` and `pnpm check` pass.
- `pnpm game` (or `pnpm web:dev`, same screens) shows the content.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if a content system changed
