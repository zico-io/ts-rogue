# Assets

- `urizen_onebit_tileset__v2d0.png` - [Urizen 1-bit tileset v2.0](https://vurmux.itch.io/urizen-onebit-tileset) by vurmux, CC-BY-4.0. 12 px tiles on a 13 px pitch (1 px outer margin and gutters). Still the source for every overworld/dungeon-minimap atlas frame (ROG-68); the browser atlas resamples these down to the shared 8x8 output grid (`scripts/build-atlas.ts`) pending a real Minifantasy re-skin (ROG-62/ROG-65/ROG-69).

## Minifantasy (Krishna Palacio) - hybrid world/dungeon/UI/effects source (ROG-67/ROG-68)

Licensed and staged for the art-direction hybrid (`src/web/ART_DIRECTION.md` §9), acquired as itch.io downloads attached to ROG-68: the `Minifantasy_Dungeon_v2.3_Commercial_Version`, `Minifantasy_Creatures_v3.3_Commercial_Version`, `Minifantasy_TinyOverworld_v1.0`, `Minifantasy_UI_Overhaul_v1.0`, and `Minifantasy_Spell_Effects_v1.0`/`_II_v1.0` packs. Not yet vendored into this directory - no sprite from these packs is wired into the atlas or a scene yet, so nothing is committed until a follow-up ticket (ROG-62 tile readability, ROG-65 overworld atmosphere, ROG-69 dungeon evolution, ROG-71 effects) actually consumes specific frames. ROG-64 (HUD/windowskin) shipped its beveled navy panel and meters procedurally (`src/web/render/pixiDrawFactory.ts`'s `bevel`/`gloss` rect options, derived from `theme.window.fill` at render time) rather than the real *UI Overhaul* 9-slice sprite, which is still un-vendored; swapping in the real sprite sheet is a follow-up once the pack lands here. Re-acquire from https://krishna-palacio.itch.io (individual packs) or https://itch.io/s/45421/minifantasy-complete-bundle (bundle) when that lands.

License (verified against the bundled `CommercialLicense.txt`/pack pages, 2026-07-23 - this is stricter than the "no attribution required" note in `ART_DIRECTION.md` §9, which should be read as superseded by this entry): commercial and non-commercial use and modification are permitted, unlimited; no re-distribution or re-sale of the raw or edited assets as game assets/images/NFTs; **attribution to Krishna Palacio in the shipped game's credits is required**, plus a link to the finished project sent to the author.

## Aekashics Librarium - front-facing battle monsters (ROG-67/ROG-68)

- `aekashics/slime.png`, `aekashics/goblin.png`, `aekashics/dungeon-guardian.png` - front-facing battler art for the three current `MonsterDef`s (`src/data/monsters.ts`), from the [Aekashics Librarium free Ultrapack](https://aekashics.itch.io/librarium-statics-ultimate-monsters) ("Frontview Batch Battlers" in the Static Battlers compilation), sourced as `Slimei.png`, `Goblin Grunt.png`, and `Boss Runic Stone Golem Goliath.png` respectively. Battlers are a separate scale class from the 8x8 atlas (`src/web/ART_DIRECTION.md` §2.1): the browser loads each as its own texture (`src/web/battlers.ts`), never packed into `atlas.png`. The terminal renderer is unaffected - it still draws these three monsters from the Urizen-sourced `TILE_SOURCES` entries in `src/ui/tiles/kitty.ts`.

License (verified against http://www.akashics.moe/terms-of-use/, 2026-07-23): usable in commercial and non-commercial games, any engine; edits (recolor/resize) for project needs are fine; **attribution ("Ækashics", linking back to akashics.moe) is required**; no redistribution of the raw or edited battler files outside the shipped game.

## Silkscreen - HUD bitmap font (ROG-64)

- `../src/web/public/fonts/Silkscreen-{Regular,Bold}.ttf`, `../src/web/public/fonts/OFL.txt` - [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, via Google Fonts (https://github.com/googlefonts/silkscreen). Loaded once at boot (`src/web/font.ts`) and installed as a Pixi `BitmapFont` the shared HUD chrome draw factory (`src/web/render/pixiDrawFactory.ts`) uses for every chrome text, replacing the inline `fontFamily: "monospace"` there.

License: SIL Open Font License, Version 1.1 (full text in `OFL.txt` alongside the font files, as OFL §2 requires when bundling the font). Free to embed/modify/redistribute with the shipped game; no attribution required beyond keeping the license file, though it's credited here per this file's existing convention.

Tiles render via the kitty graphics protocol (Ghostty/kitty). Inside tmux you need `set -g allow-passthrough on` (tmux >= 3.3, off by default).
