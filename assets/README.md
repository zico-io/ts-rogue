# Assets

## Minifantasy (Krishna Palacio) - world/dungeon atlas source (ROG-67/ROG-68)

`minifantasy/*.png` - the vendored source sheets the browser atlas is packed from (`scripts/build-atlas.ts`, coordinates in `src/ui/tiles/sources.ts`). Each is native 8x8 pixel art. Acquired as itch.io downloads attached to ROG-68; only the specific sheets the atlas consumes are committed here:

- `forgotten_plains.png` - Tiny Overworld / Forgotten Plains tileset. Feeds `grass`, `water`, `mountain`, plus `mountainSmall`/`mountainLarge` (ROG-73: same mossy-boulder family, color-matched crops of genuinely smaller/larger rock formations already on this sheet, used for a mountain tile's local-cluster-density auto-tile stand-in - `src/ui/tiles/overworldVariants.ts`). The pack also ships a `Biomes_Merging_Tiles` sheet with cross-biome edge blends, not vendored here - its dithered transitions aren't safely hand-croppable without a way to visually verify the result; see ROG-73's PR notes for the follow-up.
- `overworld_props.png` - Tiny Overworld / All Props. Feeds `forest` (a tree).
- `constructions.png` - Tiny Overworld / Constructions. Feeds the `village` and `dungeonEntrance` markers (single-tile crops from multi-tile buildings; interim reads pending the dedicated Towns pack, ROG-65).
- `dungeon_tileset.png` - Dungeon tileset. Feeds `wall`, `floor`, `stairsDown`.
- `dungeon_props.png` - Dungeon props. Feeds `chest` and the `boss` marker (a gravestone).
- `human_idle.png` - Dungeon human idle sheet; frame 0 cropped to the character's bounds for the top-down `player` marker.

This replaced the old monochrome Urizen 1-bit tileset (ROG-44), which was CC-BY-4.0 by vurmux and is no longer used. Re-acquire the full packs from https://krishna-palacio.itch.io (individual) or https://itch.io/s/45421/minifantasy-complete-bundle (bundle). ROG-64 (HUD/windowskin) still draws its beveled navy panel and meters procedurally rather than from the *UI Overhaul* sprite; swapping in the real 9-slice is a follow-up once that pack is vendored.

License (verified against the bundled `CommercialLicense.txt`/pack pages, 2026-07-23 - this supersedes the "no attribution required" note in `ART_DIRECTION.md` §9): commercial and non-commercial use and modification are permitted, unlimited; no re-distribution or re-sale of the raw or edited assets as game assets/images/NFTs; **attribution to Krishna Palacio in the shipped game's credits is required**, plus a link to the finished project sent to the author.

## Aekashics Librarium - front-facing battle monsters (ROG-67/ROG-68)

- `aekashics/slime.png`, `aekashics/goblin.png`, `aekashics/dungeon-guardian.png` - front-facing battler art for the three current `MonsterDef`s (`src/data/monsters.ts`), from the [Aekashics Librarium free Ultrapack](https://aekashics.itch.io/librarium-statics-ultimate-monsters) ("Frontview Batch Battlers" in the Static Battlers compilation), sourced as `Slimei.png`, `Goblin Grunt.png`, and `Boss Runic Stone Golem Goliath.png` respectively. Battlers are a separate scale class from the 8x8 atlas (`src/web/ART_DIRECTION.md` §2.1): the browser loads each as its own texture (`src/web/battlers.ts`), never packed into `atlas.png`. The terminal renderer is unaffected - it is pure ASCII and draws every monster from the `ascii` art in `src/data/monsters.ts`.

License (verified against http://www.akashics.moe/terms-of-use/, 2026-07-23): usable in commercial and non-commercial games, any engine; edits (recolor/resize) for project needs are fine; **attribution ("Ækashics", linking back to akashics.moe) is required**; no redistribution of the raw or edited battler files outside the shipped game.

## Silkscreen - HUD bitmap font (ROG-64)

- `../src/web/public/fonts/Silkscreen-{Regular,Bold}.ttf`, `../src/web/public/fonts/OFL.txt` - [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, via Google Fonts (https://github.com/googlefonts/silkscreen). Loaded once at boot (`src/web/font.ts`) and installed as a Pixi `BitmapFont` the shared HUD chrome draw factory (`src/web/render/pixiDrawFactory.ts`) uses for every chrome text, replacing the inline `fontFamily: "monospace"` there.

License: SIL Open Font License, Version 1.1 (full text in `OFL.txt` alongside the font files, as OFL §2 requires when bundling the font). Free to embed/modify/redistribute with the shipped game; no attribution required beyond keeping the license file, though it's credited here per this file's existing convention.
