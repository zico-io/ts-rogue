# Art direction - the high-fidelity browser renderer (ROG-67)

The visual target for the PixiJS renderer (`src/web`). This is the **bar**, not
an implementation ticket: follow-up issues (palette evolution, the 12->16px
atlas migration, per-scene reskins, dungeon atmosphere) build against it. A
companion mood board renders the palette and per-scene composition visually.

Today every scene draws the monochrome **Urizen 1-bit tileset** (12x12,
`assets/urizen_onebit_tileset__v2d0.png`) tinted by the ROG-31 palette
(`src/ui/theme.ts`). This document defines where we take it.

## 1. Vision / north star

**A cozy-but-epic 16-bit console RPG, seen through a scrying portal.** The
touchstones are **Dragon Quest V** and **Final Fantasy VI** for the top-down
world and the navy-windowskin UI, and **Wizardry / DQ first-person** for the
dungeon and battle framing (which the engine already models: discrete
position+facing dungeon, front-facing battle art). Warm, saturated, and
*readable* - never muddy, never grimdark. The portal chrome (ROG-54) frames it
like a handheld console held up to the light.

**Sourcing model (hybrid, ROG-67).** The world is one cohesive source and the
battle is a deliberate exception:

- **World, dungeon, UI, and effects: [Minifantasy](https://krishna-palacio.itch.io) (Krishna Palacio).**
  78 packs by one artist in one palette - cohesion by construction, and it maps
  naturally onto the existing navy/torchlit `theme.ts`. Its dark-fantasy mood
  becomes the world's register (warmer and more saturated than raw Minifantasy,
  via §3 grading - never grimdark).
- **Battle monsters: [Aekashics Librarium](https://aekashics.itch.io/librarium-statics-ultimate-monsters) front-facing battlers.**
  Minifantasy creatures are top-down/side, not the front-on DQ/Wizardry battlers
  the battle scene wants, so the battle takes a purpose-built source. This is the
  one seam.

**The rule that heals the seam:** a single palette, a single lighting
convention, and a mandatory (not optional) palette-lock grade so the Minifantasy
world and the Aekashics battlers read as one world. Consistency of *treatment*
carries the one place authorship differs.

## 2. Cohesion strategy (the crux)

Four global constraints every asset obeys, so the two sources read as one world:

1. **One base pixel density - 8x8 (Minifantasy).** The world/dungeon/UI atlas
   adopts Minifantasy's native **8x8** grid (its Tiny Overworld packs go to 4x4;
   avoid those for playfield tiles). Battlers are a separate scale class - large
   front-view sprites loaded as individual textures, not atlas tiles - so they
   don't share the 8px grid, only the palette and lighting. Nearest-neighbor
   upscaling stays (`texture.source.scaleMode = "nearest"`); at 8px, dungeon
   raycaster walls read deliberately chunky - lean into it (§4). This is a
   discrete follow-up step: it touches `TILE_SOURCES` (`src/ui/tiles/kitty.ts`),
   `ATLAS_FRAMES` and the grid math in `scripts/build-atlas.ts` (12x12 -> 8x8),
   and the `UNIT_PX` pitch in `src/web/render/sceneView.ts`.
2. **One unified palette.** Every sprite - Minifantasy tiles *and* Aekashics
   battlers - is quantized/tinted toward the evolved ROG-31 ramp (§3) at import
   time. Off-palette source art is recolored, not left as-is; this is what makes
   an Aekashics battler sit inside a Minifantasy scene.
3. **One lighting + outline convention.** Top-left key light, warm highlights /
   cool shadows, selective dark outlines (interior detail can be outline-free),
   no anti-aliasing.
4. **One mandatory palette-lock pass.** A final Pixi color-grade/LUT filter over
   the whole frame - **required, not optional, in the hybrid** - is what
   guarantees the Minifantasy world and the Aekashics battle land in the same
   world. Lives behind the existing `pixi*DrawFactory` boundary.

## 3. Palette direction

**Evolve `src/ui/theme.ts`; do not replace it.** The ROG-31 palette is already
JRPG-friendly (warm parchment text, indigo chrome, amber accent). Targeted
changes:

- **Keep** `text #f2f2da`, `accent/borderFocus #e3aa3e`, and the state colors
  (`danger #e74343`, `heal #5fae3b`, `mp #23b4e9`, `gold #fbc254`) - these
  already read 16-bit JRPG.
- **Add a `window` token family** for the classic navy JRPG windowskin: deep
  navy fill (~`#1b2a63`), a lighter top-left bevel highlight, a darker
  bottom-right bevel shadow, and the existing amber for the frame border. This
  replaces the flat bordered panel with a beveled console window.
- **Warm and saturate the biomes** slightly (grass/forest/water/mountain) so the
  overworld reads sunlit rather than washed - the `biome` token group.
- **Re-anchor `DUNGEON_RAMPS`** from the current teal/indigo/ember trio into
  **torch-warm-near -> cool-dark-far** depth fog: a warm amber close band
  fading to a desaturated navy at `MAX_DEPTH`. Torchlight, not zone tint, is the
  organizing idea. Keep one ramp per dungeon for identity, but all three share
  the warm-near/cool-far shape.

## 4. Environmental treatment (per scene)

- **Overworld / village (top-down).** Minifantasy *Forgotten Plains* +
  *Plants & Foliage* for biomes, *Towns I/II* / *Medieval City* / the *Kingdom*
  packs for the village. Rich biome tiles with proper transition edges
  (grass->water shoreline, forest edges), soft ambient drop-shadow under props
  and the party marker. Animated water shimmer and foliage sway are a follow-up
  nicety, not required for the bar. Maps onto the existing `TILE_GLYPHS` +
  `biome` tokens in `src/ui/screens/overworld/render.ts`.
- **Dungeon (first-person, evolved raycaster).** Keep the DDA raycaster core
  (`src/web/render/dungeonRaycast.ts`) - it already does per-column texel
  sampling (`TEXELS_PER_TILE`) and depth. Raise the bar on top of it:
  - **Textured walls** sampled from Minifantasy *Dungeon* / *Deep Caves* /
    *Sewers* wall tiles (the raycaster already swaps per-column sub-textures).
    At 8px these read deliberately chunky - the atmosphere layers below carry
    the fidelity, not texel density.
  - **Floor + ceiling** as vertical gradients split at the horizon, tinted by
    the torch ramp instead of flat colors.
  - **Torch lighting** as the primary mood driver: near columns warm and bright,
    far columns fading into the cool `dungeonRamp` fog.
  - **Parallax atmosphere band** behind the geometry (a faint far-wall haze /
    distant glow) so corridors have depth beyond the wall plane.
  - **Dust motes** - a light Pixi particle layer drifting through torchlight.
  - **Lit billboard sprites** for chests / stairs / boss marker (already
    projected by `castBillboards`), tinted by their column's depth so they sit
    *in* the lighting, not on top of it.
- **Battle (front-on).** Front-facing DQ-style monster sprites - the one
  Aekashics-sourced scene (see §9) - graded to the palette so they sit inside
  the Minifantasy world, on a dark vertical-gradient backdrop keyed to the
  current dungeon/biome, with a rim/hero light so silhouettes pop. The floating
  damage numbers and hit-flash
  already derived from HP deltas in `src/web/render/battleView.ts` get restyled
  (bold outlined numerals, color by kind) - the derivation logic stays; only the
  draw adapter changes.

## 5. UI styling

- **Navy 9-slice windowskin** (Minifantasy *UI Overhaul* pack, regraded to the
  navy `window` token) for the HUD chrome frame, replacing the flat bordered
  panel. Lands in `src/web/render/sceneView.ts` (chrome interpreter,
  framework-free) + `src/web/render/pixiDrawFactory.ts` (the Pixi adapter);
  `buildChrome` (`src/ui/scene/chrome.ts`) stays untouched.
- **HP/MP meters** keep the real filled-rect approach (already better than the
  terminal's glyph bars) but gain a bevel + a subtle top gloss line, colored by
  the existing `hpColor`/`mpColor` state logic.
- **A bitmap pixel font** replaces the inline `fontFamily: "monospace"` used
  everywhere in the Pixi text. Candidate: a permissively-licensed pixel bitmap
  font loaded via Pixi `BitmapFont` (e.g. "m5x7"/"m6x11" by Daniel Linssen, or a
  CC0 pixel font) - crisp at integer scales, no browser font fallback drift.
- **Selection cursor** (menus, battle targeting) becomes a small amber
  arrow/glyph in the windowskin style rather than a color swap.
- **Message log** gets per-kind color (already in `theme.msg`) plus a faint
  age-fade on older lines.

## 6. Effects & particles

Effects are where 16-bit RPGs earn their drama - a spell that flashes the
screen, sparks off a parried blow, embers rising off a torch. The organizing
principle keeps them safe for the dual-renderer seam:

**All effects are renderer-local.** They are driven by the Pixi `Application`
ticker and derived from state *deltas observed across renders* - exactly how
`src/web/render/battleView.ts` already produces floating damage numbers and the
hit-flash from HP deltas. The engine (`GameState`/`GameEvent`) stays pure and
has no concept of a spark, a shake, or an ember; the terminal renderer is
unaffected. A new effect never means a new `GameEvent`.

**Tech (ponytail):** a small hand-rolled emitter over Pixi v8's built-in
`ParticleContainer` - **zero new dependencies**. It lives behind the same
framework-free-view + `DrawFactory` seam as everything else, with a
`tick(deltaMS)` that ages/removes particles wired once to the ticker (the same
hook `BattleSceneView.tick` already uses). Reach for `@pixi/particle-emitter`
only if the hand-rolled one measurably falls short. Pool particle objects and
cap concurrent counts.

**Two tracks (hybrid):** discrete, *keyed* effects - spell casts, weapon
impacts, big hits - play as **pre-animated Minifantasy sprite sheets**
(*Spell Effects I/II*, *Magic And Sorcery*, *Magic Weapons And Effects*) via a
frame ticker, so they're in-style and hand-animated for free. **Ambient,
continuous** effects - dust motes, torch embers, water sparkle, footstep puffs -
stay procedural on the `ParticleContainer` emitter. A keyed effect is a sprite
animation triggered by a state delta; an ambient effect is a particle field.
Both are renderer-local and graded with the frame.

Per-scene effect vocabulary, all colored from the palette so effects read as the
same world:

- **Battle (the showcase).** Hit sparks + a quick slash arc on melee; elemental
  spell bursts - fire embers (`warn`/`danger`), ice shards (`mp`), lightning
  flash (`gold`/`accent`), arcane motes (`unique #ca7ef2`), poison haze
  (`quest`/green); a brief, small **screen shake** + white hit-flash on heavy
  hits (flash already exists); heal sparkles rising (`heal`); buff/debuff auras;
  an enemy **death dissolve** (fade + scatter). Floating numerals stay on top.
- **Dungeon.** Torch flicker + rising embers at light sources; drifting **dust
  motes** in the light cone; a faint depth-fog haze; a glint on billboard
  chests/stairs; a small footstep dust puff on move.
- **Overworld.** Water shimmer/sparkle; foliage sway; ambient drift keyed to
  biome (leaves in forest, fireflies at dusk); footstep puffs; a soft pulse on
  the village and dungeon-entrance markers; a level-up flourish.
- **UI / feedback.** Selection-cursor glint; a **loot burst** colored by rarity
  (`common/magic/rare/unique`); gold-coin sparkle; a low-HP vignette pulse.

**Legibility guardrail:** effects never bury the readable layer. Spell flashes
are brief, damage numerals draw last, screen shake stays small and short, and
everything is **additive and gated on `prefers-reduced-motion`** - the same rule
the codebase already follows (content fully legible with motion off). This ties
directly to the contrast goals below.

## 7. Contrast goals (testable)

- **Body text >= WCAG AA (4.5:1)** against its panel fill. Reference:
  `text #f2f2da` on `window #1b2a63` ~= **11.9:1** (headroom to spare);
  `textMuted #a59b9d` on the same navy ~= **5:1** (passes AA for body). Any new
  window fill must keep `text` above 4.5:1.
- **HP/MP meter states** must be distinguishable at a glance: healthy `heal`,
  hurt `warn #f8a64c`, critical `danger #e74343` differ in hue *and* value, not
  hue alone.
- **Dungeon depth read:** the near-wall band and the `MAX_DEPTH` fog band must
  differ by a clear luminance gap (target >= 3:1 near-vs-far) so distance is
  legible without the minimap.
- **Battle monster silhouette** must clear its backdrop by >= 3:1 luminance at
  the sprite edge - the rim light exists to guarantee this on dark backdrops.

## 8. Scene composition

The portal chrome (ROG-54) letterboxes everything at 3:2; these layouts live
*inside* that portal.

- **Title:** centered pink->purple wordmark (`theme.logoGradient`) high, menu in
  a navy window below center, subtle animated dungeon/starfield behind.
- **Overworld:** full-bleed tile map, party marker centered, HUD chrome window
  docked bottom, minimap top-right.

  ```
  +--------------------------------------+
  |                              [minimap]|
  |            . . % % ^                  |
  |          . . @ . . ~                  |   @ = party, centered
  |            . . H . .                  |
  | +----------------------------------+  |
  | | HP ####----  MP ##------   G:120 |  |   navy windowskin
  | +----------------------------------+  |
  +--------------------------------------+
  ```

- **Village:** same chrome; content region is a navy menu window (building list
  / building interior), driven by the existing focus state.
- **Dungeon (first-person):**

  ```
  +--------------------------------------+
  |::::::::::::  ceiling gradient  :::::::|
  |======|                    |==========|   textured walls,
  |======|      [ ]stairs      |=========|   torch-warm near ->
  |======|                     |=========|   cool-dark far
  |------------ horizon ------------------|
  |........  floor gradient  .............|
  | +--------------------+     [minimap]  |
  | | HP ####  MP ##     |               |   party window + facing mark
  +--------------------------------------+
  ```

- **Battle:** monster sprites arranged by the existing `packEnemyColumns`
  layout on a dark gradient backdrop, command/skill/item/target menu in a navy
  window bottom-left, target cursor an amber arrow, floating damage numerals
  over the struck enemy.
- **Game over:** red-ramp banner (`theme.gameOverGradient`) centered over a
  darkened, desaturated last frame; prompt in a navy window.

## 9. itch.io asset plan + licensing

Two sources, tinted to one §3 palette. Everything from the
[Minifantasy Complete Bundle](https://itch.io/s/45421/minifantasy-complete-bundle)
except the battle, which is Aekashics. Every pack's license is attributed in
`assets/README.md` next to the existing Urizen CC-BY-4.0 entry.

| Need | Pack | Notes |
| --- | --- | --- |
| Overworld / village tiles | Minifantasy *Forgotten Plains*, *Plants & Foliage*, *Towns I/II*, *Medieval City*, *Kingdom* packs | 8x8, one palette. *Forgotten Plains*, *Dungeon*, *Creatures* are pay-what-you-want (free) - trial the style at $0 first. |
| Dungeon wall/floor texels | Minifantasy *Dungeon*, *Deep Caves*, *Sewers* | Sample wall tiles as raycaster textures; chunky at 8px by design (§4). |
| UI windowskin / icons | Minifantasy *UI Overhaul* | 9-slice window + icons; regrade to the navy `window` token. |
| Effects (keyed) | Minifantasy *Spell Effects I/II*, *Magic And Sorcery*, *Magic Weapons And Effects* | Pre-animated sheets played on a frame ticker (§6). |
| **Front-facing battle monsters** | [Aekashics Librarium (free Ultrapack)](https://aekashics.itch.io/librarium-statics-ultimate-monsters) | The one non-Minifantasy source. 900+ front-facing battlers, royalty-free commercial; graded to the palette (§2.4) so they sit in-world. Sets `sprite` on `MonsterDef` in `src/data/monsters.ts`. |

**Licensing (verified ROG-68, see `assets/README.md` for the pinned text):**
Minifantasy's license permits commercial use and modification, unlimited, but
**requires attribution** to Krishna Palacio in the shipped game's credits (not
attribution-free as earlier drafted here); no resale/redistribution of the raw
art. $69.99 for 78 packs (reg. $438). Aekashics Librarium is commercial-friendly
but likewise **requires attribution** to Ækashics with a link back to
akashics.moe; no redistribution of the raw battler files. Both are
permissive-commercial-with-attribution, compatible with the repo's CC-BY-4.0
baseline (which itself requires attribution).

## 10. Pipeline mapping - where follow-up work lands

The renderer's seam is already clean (framework-free `*View.ts` behind
`DrawFactory` interfaces; real Pixi only in `pixi*DrawFactory.ts`, `atlas.ts`,
`bootGame.ts`). Art fidelity lands in three places, keeping the tested view
logic untouched:

| Follow-up issue | Primary files |
| --- | --- |
| Palette evolution (§3) | `src/ui/theme.ts` (shared by both renderers - verify terminal still reads sanely) |
| Atlas 12->8px migration (§2.1) | `src/ui/tiles/kitty.ts` (`TILE_SOURCES`), `scripts/build-atlas.ts` (`ATLAS_FRAMES`, grid math -> Minifantasy 8x8), regenerate `src/web/public/atlas/*` |
| New sprites (Minifantasy biomes/dungeon/UI; Aekashics battlers) | atlas pipeline for 8px tiles; battlers loaded as individual textures, `sprite` on `MonsterDef` in `src/data/monsters.ts` |
| Navy windowskin + meters + bitmap font (§5) | `src/web/render/sceneView.ts`, `src/web/render/pixiDrawFactory.ts`, `bootGame.ts` (font load) |
| Dungeon atmosphere/lighting/particles (§4) | `src/web/render/dungeonView.ts`, `src/web/render/pixiDungeonDrawFactory.ts` (geometry in `dungeonRaycast.ts` stays) |
| Battle sprites/backdrop/light (§4) | `src/web/render/battleView.ts`, `src/web/render/pixiBattleDrawFactory.ts` |
| Effects & particles (§6) | keyed effects = Minifantasy sprite-sheet player; ambient = a shared `ParticleContainer`-backed emitter; both behind a `DrawFactory`, consumed by `battleView.ts` / `dungeonView.ts` / `overworldView.ts` and their `pixi*DrawFactory.ts` adapters; ticker already wired via `BattleSceneView.tick` |

**Guardrail:** `src/ui/theme.ts` is shared with the terminal renderer. Any
palette change must keep `pnpm game` (terminal) legible too, per the
GameStore/GameEvent seam contract in `src/web/README.md`. Both renderers must
still boot.
