---
name: add-content
description: Add game content via the src/data tables (monster, item, etc.) plus its browser sprite through the atlas pipeline.
triggers:
  - "add monster"
  - "add item"
  - "add sprite"
  - "new content"
  - "atlas"
  - "tile"
edges:
  - target: context/web-renderer.md
    condition: for the atlas/art pipeline and the terminal-vs-browser art split
  - target: context/engine.md
    condition: for how data definitions feed combat/loot state
grounds_to: []
last_updated: 2026-07-28
---

# Add content (data table + sprite)

## Context

Static content lives in `src/data` (`monsters.ts`, items, `dungeons.ts`,
`quests.ts`, `classes`, affixes, loot tables). The engine reads these; it never
hardcodes content. The terminal renderer draws content as ASCII (`MonsterDef.ascii`);
the browser draws sprites from a packed atlas. The two art paths are
independent — adding a sprite is additive and never touches the terminal.

## Steps

1. **Data:** add/extend the definition in the matching `src/data/*.ts` table.
   A monster carries `ascii` (terminal) and optionally `sprite` (browser),
   `color`, `skills`, drops. It flows into `BattleEnemy` via
   `src/engine/combat/resolution.ts` automatically.
2. **Browser sprite (only if drawn in the web renderer):**
   - Add a frame rect to `TILE_SOURCES` in `src/ui/tiles/sources.ts` (use
     `at(sheet, col, row)` for a plain 8x8 tile, or a raw `{x,y,w,h}`).
   - Regenerate the atlas by running the `scripts/build-atlas.ts` tsx script
     (e.g. via `tsx scripts/build-atlas.ts`) — it rewrites
     `src/web/public/atlas/atlas.png` + `atlas.json`. **Commit both.**
   - Set `sprite: "<frame>"` on the `MonsterDef`. Look it up as
     `sheet.textures["<frame>"]` and set `texture.source.scaleMode = "nearest"`.
   - Battle monsters are separate individually-loaded textures (`battlers.ts`),
     not packed into the atlas.
3. Add a vitest test if the content introduces new behavior (a new skill, drop
   rule, etc.).

## Gotchas

- `public/atlas/atlas.{png,json}` is **generated — never hand-edit**; always
  regenerate via the script and commit the result.
- A `BattleEnemy` with a missing/unknown `sprite` id falls back to a tinted
  rect in the browser — battles never break on a missing sprite, so a broken
  frame name fails silently visually. Verify the frame renders.
- Terminal art uses none of the atlas; don't assume a sprite change shows up in
  `pnpm game`.

## Verify

- `pnpm test:unit` and `pnpm check` pass.
- Terminal: `pnpm game` shows the ASCII content.
- Browser: `pnpm web:dev` (play-web harness screenshot) shows the sprite; the
  atlas files are regenerated and committed.

## Debug

Sprite missing in browser: confirm the frame name is in `TILE_SOURCES`, the
atlas was regenerated, and `sprite` on the def matches the frame name exactly.

## Update Scaffold
- [ ] Update `.mex/context/web-renderer.md` if the atlas/art pipeline changed
- [ ] Update `.mex/ROUTER.md` "Current Project State" if a content system changed
