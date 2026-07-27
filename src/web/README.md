# Browser renderer

A PixiJS renderer that boots the same engine core (`src/engine`) the Ink
terminal renderer (`src/app.tsx`, `src/ui`) uses, driven from the browser
instead of a terminal.

The renderer is wrapped in a Next.js "chrome" (ROG-54): a static-exported app
shell (`app/`) that frames the canvas as a centred, letterboxed **portal** into
the dungeon world instead of a raw full-viewport canvas. See "Chrome (ROG-54)"
below.

## Running

```bash
pnpm web:dev
```

Open the printed local URL. Boot query params mirror the terminal's CLI flags:

| Param | Terminal equivalent | Effect |
| --- | --- | --- |
| `?seed=123` | `--seed=123` | Seeds the new run; defaults to `Date.now()` |
| `?fresh` | `--fresh` | Presence-only; bypasses loading the IndexedDB save on boot (ROG-46), so a session always starts fresh |
| `?dev` | `--dev` | Gates the dev console overlay (ROG-48); backtick toggles it |

`pnpm web:build` produces a static Next.js export in `src/web/out`;
`pnpm web:preview` serves that build locally.

## The GameStore/GameEvent seam (ROG-53)

This renderer and the terminal one (`src/app.tsx`, `src/ui`) are two
independent drawing layers glued to one shared, engine-owned contract:

- `GameStore` (`src/engine/state/store.ts`) is the only place a `GameEvent`
  turns into a new `GameState` - `dispatch(event)` runs the pure `reduce`
  function, validates the result, and notifies every `subscribe` listener
  with the new state. Neither renderer mutates `GameState` directly or
  reimplements any reducer logic; both only ever call `store.dispatch(...)`
  and read `store.getState()`.
- `GameEvent` (`src/engine/state/types.ts`) is the closed set of actions
  either renderer can perform - `NewGame`, `ChangeScene`, `MoveOverworld`,
  battle/village/dungeon events, and so on. A new player action means adding
  a `GameEvent` variant and a `reduce` case in the engine first, not
  special-casing one renderer.
- Everything renderer-specific - Pixi containers here, Ink components in
  `src/ui` - lives strictly downstream of `store.subscribe`: read
  `store.getState()`, draw it, and dispatch `GameEvent`s back in response to
  input. `src/ui/scene/chrome.ts`'s `buildChrome` and the interaction
  reducers under `src/ui/screens/**/interaction.ts` are the framework-free
  middle layer both renderers already share on the drawing and input sides
  (see "Structure" below); reach for that shared layer before adding
  renderer-local logic.
- **Engine changes must keep both frontends working.** A change to
  `src/engine` (a new `GameEvent`, a new `GameState` field, a changed
  reducer) is not done until both `pnpm game` (terminal) and `pnpm web:dev`
  (this renderer) still boot and handle it - run both, not just the one you
  were testing in. CI enforces the mechanical half of this: `pnpm check`
  typechecks and tests the whole repository (both entries share one
  `tsc --noEmit` pass) and lints in cross-boundary import guardrails (below);
  `pnpm web:build` (a separate CI step) additionally proves this renderer's
  `vite build` still succeeds. Neither check can see "does the new event
  make sense in a Pixi container", so review both UIs by eye for anything
  that isn't purely mechanical.

### Cross-boundary import guardrails

Biome (`biome.json` overrides) enforces the split CI relies on:

- `src/web/**` may not import `ink` or any Node.js builtin module
  (`node:*` or bare, e.g. `node:fs`, `fs`) - `lint/style/noRestrictedImports`
  and `lint/correctness/noNodejsModules`.
- `src/app.tsx` and `src/ui/**` may not import `pixi.js`
  (`lint/style/noRestrictedImports`) or touch DOM globals like `window`,
  `document`, or `localStorage` (`lint/style/noRestrictedGlobals`).

`pnpm lint` (part of `pnpm check`) runs these on every push and pull request,
so a cross-boundary import fails CI instead of silently coupling the two
renderers.

## Structure

- `boot.ts` - parses boot query params into `BootFlags`. Pure, unit-tested in
  `boot.test.ts`.
- `scenes.ts` - pure scene-switching logic (`SceneSwitcher`) that shows one
  scene view at a time and refreshes each with a state-derived label, without
  depending on Pixi or the DOM. Unit-tested in `scenes.test.ts`.
- `atlas.ts` - loads the packed sprite atlas through Pixi's `Assets` loader
  (ROG-44); see "Art pipeline" below.
- `render/sceneView.ts` - `SceneChromeView` (ROG-47): the Pixi interpreter for
  the shared HUD chrome tree `buildChrome` (`src/ui/scene/chrome.ts`)
  produces - the same tree `src/ui/components/Screen.tsx` walks for the
  terminal. Draws the amber-bordered, beveled navy `window`-token panel
  (ROG-64), real filled-rect HP/MP meters with a bevel + gloss line
  (replacing the terminal's glyph bars), a title-divider hairline, and the
  message log tail with a per-line age-fade, keeping every draw object keyed
  by `node.key` so a dispatch only updates what changed instead of
  rebuilding the chrome. Framework-free (no `pixi.js` import) behind a
  `DrawFactory` interface, so it's unit-tested in `sceneView.test.ts`
  without a real WebGL/canvas context.
- `render/pixiDrawFactory.ts` - `createPixiDrawFactory`: the thin adapter that
  implements `sceneView.ts`'s `DrawFactory` with real Pixi `Graphics`/`Text`
  (or `BitmapText`, once `font.ts`'s HUD font is installed) objects added to
  a given container. `createRect`'s `bevel`/`gloss` options derive their
  highlight/shadow/gloss shades from the rect's own fill color at draw time
  (ROG-64), so one primitive draws both the windowskin panel and any
  dynamically-colored HP/MP meter. Not unit-tested (thin Pixi glue, like
  `atlas.ts`).
- `font.ts` - `loadHudFont`/`isHudFontReady` (ROG-64): loads the vendored
  Silkscreen pixel font (`public/fonts/`, OFL-1.1) via the `FontFace` API and
  installs it as a Pixi `BitmapFont` (`HUD_FONT_FAMILY`) so HUD chrome text
  is pre-rasterized and reads crisp at integer scale. Best-effort: a failed
  load leaves `isHudFontReady()` false and `pixiDrawFactory.ts` falls back to
  a canvas `Text` in `monospace`. Not unit-tested (thin Pixi/DOM glue).
- `bootGame.ts` - exports `bootGame(mount, flags)`, which builds the initial
  `GameState`, wires a `GameStore`, initializes the Pixi `Application` into the
  given `mount` element, builds one `Container` per scene plus its
  `SceneChromeView` and content sub-container, loads the atlas, wires the
  keyboard manager, and owns the title/game-over `Phase` on top of the store's
  own scenes (see "Title, village, and game-over" below). A single
  `renderCurrent()` redraws whatever should be visible - called from
  `store.subscribe` (a `GameStore` dispatch), the Pixi renderer's `resize`
  event, and after every keydown, since menu-cursor moves and other local-only
  UI state don't dispatch a `GameEvent` and would otherwise never redraw. It
  returns a `dispose()` handle that removes every `window` listener, destroys
  the Pixi app, and clears the mount, so the React chrome can mount/unmount it
  (including dev StrictMode's double-invoke) without leaking a second game. Was
  `main.ts`'s module top level under the old Vite entry.
- `app/` - the Next.js chrome (ROG-54): `page.tsx` renders the portal frame +
  wordmark + controls legend, and `GamePortal.tsx` (a client component) mounts
  the canvas by lazily importing `bootGame` inside a `useEffect`. See "Chrome
  (ROG-54)" below.
- `input/normalizeBrowserKey.ts` - normalizes a DOM `KeyboardEvent` (or the
  minimal `{ key, ctrlKey, metaKey }` shape tests construct) to the same
  `KeyName` alphabet `normalizeInkKey` produces for the terminal. Pure,
  unit-tested in `input/normalizeBrowserKey.test.ts`.
- `input/keyboard.ts` - `BrowserKeyboardManager` (ROG-45): a `keydown`
  listener wired in `main.ts` that resolves the global scene-hotkey/
  dev-console/quit/fast-travel keymap first, then routes to whichever scene -
  and, inside the village, whichever sub-view (overview/inn/church/store/tavern)
  - currently has focus, via the exact same `interaction.ts` modules under
  `src/ui/screens/**` the Ink renderer uses. No keymap or reducer logic is
  duplicated here. `main.ts` only calls into it while the game is being
  played (not during the title flow or a game-over screen; see below) and
  passes it an `onQuit` callback (ROG-52) that returns to the title screen.
  ENG-1 adds a dungeon evac confirm (`<` then y/n) and the Zoom fast-travel
  picker (`z` from the overworld/village; the picker owns input while open
  via its own focus slot, mirroring the village sub-view pattern). Unit-tested
  in `input/keyboard.test.ts`.
- `public/atlas/` - the built atlas (`atlas.png` + `atlas.json`), served
  as-is by Next's default static-file handling for `<root>/public` (the Next
  root is `src/web`) and copied verbatim into `src/web/out/atlas/` on export.
  Generated; do not hand-edit, see below.

## Art pipeline (ROG-44)

Style: 8x8 full-color pixel art from the [Minifantasy packs](../../assets/README.md)
(`assets/minifantasy/*.png`); each atlas frame's source rect lives in
`src/ui/tiles/sources.ts` (`TILE_SOURCES`), packed by `scripts/build-atlas.ts`.
Because the frames are already full-color, overworld tiles draw untinted (the
old per-tile biome multiply-tint was a hack for the monochrome Urizen art and is
gone). Battle monsters are a separate scale class - front-facing Aekashics
battlers loaded as individual textures (`battlers.ts`), never packed into the
atlas. (The terminal renderer is pure ASCII and uses none of this - only the
browser draws tiles.)

`scripts/build-atlas.ts` slices named tile coordinates out of the sheet and
packs them into one Pixi spritesheet (`atlas.png` + `atlas.json`, hash
format) under `public/atlas/`. Frames stay at native 12x12 - Pixi scales
pixel art at render time with nearest-neighbor filtering
(`texture.source.scaleMode = "nearest"`) instead of baking a pre-scaled sprite.

`atlas.ts`'s `loadAtlas()` registers the bundle with `Assets.addBundle` and
awaits `Assets.loadBundle`, returning a `Spritesheet` whose `textures` map is
keyed by frame name. `main.ts` looks sprites up by name, e.g.
`sheet.textures.slime`.

### Adding a new sprite

1. Add an entry to `TILE_SOURCES` in `src/ui/tiles/sources.ts`: pick the source
   `sheet` (one of `SHEETS`) and the frame's rect on it. Use the `at(sheet, col,
   row)` helper for a plain 8x8 tile, or a raw `{x,y,w,h}` for an off-grid crop.
   The atlas builder packs every `TILE_SOURCES` entry - no separate frame list.
2. Regenerate the atlas: `pnpm tsx scripts/build-atlas.ts`. This rewrites
   `public/atlas/atlas.png` and `atlas.json` - commit both.
3. For a monster, set `sprite: "<name>"` on its `MonsterDef` in
   `src/data/monsters.ts` (additive, alongside `ascii`; the terminal renderer
   keeps using `ascii` unchanged). It carries through to `BattleEnemy.sprite`
   in battle state automatically via `src/engine/combat/resolution.ts`.
4. Look the texture up wherever it renders: `const sheet = await
   loadAtlas(); new Sprite(sheet.textures["<name>"])`, and set
   `texture.source.scaleMode = "nearest"` before scaling it up.

### Multi-cell textures (ENG-8) and the 2x2 village footprint (ENG-7)

A `TILE_SOURCES` entry can declare `multiCell: { wide, high }` to keep its
natural multi-cell size instead of the default single-8x8-cell squish -
`scripts/build-atlas.ts` packs it at `wide*8 x high*8` pixels rather than
resizing it down to one cell. `sources.ts`'s `footprintOf`/`footprintCells`
enumerate the covered `(col, row)` cells, and `overworldView.ts`'s
`drawFootprint`/`landmarkRegion` place one sprite per covered grid cell, each
showing only its own sub-region of the source texture
(`pixiOverworldDrawFactory.ts`'s `setTexture(name, region)`, via Pixi's
`Texture.frame`) - so the whole texture reads as one continuous image across
its footprint instead of a single squished-and-rescaled sprite or tiled
repeats of a 1x1 frame. `multiCellFixture` remains a debug-only demo (shown
via `?dev`) exercising the same mechanism.

The village is the first live user: `village` declares `multiCell: { wide: 2,
high: 2 }`, and the shared map data (`engine/world/landmarks.ts`) places its
whole 2x2 footprint at generation time - `map.village` is the footprint's
top-left anchor cell, and every covered cell is painted with the `village`
tile so movement, passability, and the village-entry trigger in
`engine/state/store.ts` all work unchanged from any of the four cells.
`overworldView.ts`'s `landmarkRegion` maps each covered cell back to its
`(col, row)` sub-region so the four sprites tile into one contiguous
building; the ground-shadow and pulse halo only draw once, anchored at the
footprint's top-left cell and sized to the whole footprint, so a multi-tile
landmark reads as one prop instead of one per covered cell. The Ink TUI
(`ui/screens/overworld/render.ts`) mirrors this with `glyphAt`, rendering the
footprint as four distinct ASCII glyphs (a peaked roof over a walled door and
window) instead of a repeated `H`.

### Overworld terrain auto-tile stand-in (ROG-73)

`render/overworldView.ts`'s `OverworldSceneView` does not draw every
grass/water/mountain/forest/village/dungeonEntrance tile at a fixed size and
texture - `src/ui/tiles/overworldVariants.ts` (pure, unit-tested in
`overworldVariants.test.ts`) computes a neighbor-driven render variant per
tile instead:

- A **water** tile bordering land grows a sand-tinted (`theme.biome.shore`)
  fringe rect on its land-adjacent side(s), a lightweight stand-in for a real
  shore-edge autotile.
- A **mountain** tile swaps to `mountainSmall`/`mountain`/`mountainLarge` -
  color-matched crops of genuinely differently-sized rock formations already
  on `forgotten_plains.png` (`mountainTexture`, ROG-73) - by its same-type
  orthogonal neighbor count, and every mountain/forest tile also scales up
  with that count (`clusterScale`): an isolated tile draws smaller, a dense
  cluster draws larger and with real extra rock detail, not just a blurrier
  upscale.
- A **dungeonEntrance** landmark (still single-cell) gets a small
  per-instance size variation (`landmarkScale`, hashed from its tile
  coordinate - never `Math.random`, so a given map always renders
  identically) instead of every instance drawing at the same size. The
  **village**'s 2x2 footprint draws at a fixed 1:1 scale instead so its four
  sprite regions stay pixel-aligned and contiguous (see ENG-7 above).

The vendored Minifantasy Tiny Overworld packs (ROG-68) don't ship a
documented bitmask autotile blob table for cross-biome edges - the pack does
include a `Biomes_Merging_Tiles` sheet, but its dithered pixel-art blends
between arbitrary biome pairs have no legend and aren't safely hand-croppable
without a way to visually verify the result, so it isn't vendored here. A
real shore/corner bitmask tileset is a follow-up once that's needed; this
ships with the sheets already vendored instead.

### Overworld tile selection and grass clutter (WEB-6)

Reviewer feedback on ROG-65 was that the overworld still read noticeably
worse than the Tiny Overworld reference set. Auditing every `TILE_SOURCES`
crop pixel-by-pixel (exhaustive per-pixel purity search over
`forgotten_plains.png`/`overworld_props.png`, not eyeballing) found two
crops that were quietly hurting legibility rather than a missing feature:
`grass` clipped a neighboring rock formation's gray shading into every
tile, and `water` was only ~62% water pixels (the rest muddy shoreline
bleed from the sheet's small illustrated ponds, which aren't a tileable
swatch). Both now point at the cleanest fully-opaque single-color regions
found in the same sheets - `water`'s crop is an 8x4 strip the atlas's
existing nearest-neighbor resize doubles into a full 8x8 tile rather than
including any land-bleed row.

Grass tiles also get sparse, deterministic ground clutter -
`grassDecoration(x, y)` in `overworldVariants.ts` picks one of four small
self-contained icons (`grassTuft`, `grassFlowerYellow`, `grassFlowerPink`,
`grassPebble`, cropped from the same `overworld_props.png` sheet the tree
comes from) for a hash-selected ~16% of grass cells, drawn as an extra small
sprite on top of the base tile in `OverworldSceneView.drawViewport` - so a
field of grass reads as more than one repeated tile without touching the
camera/viewport math or the biome/token model. A genuine diagonal
water/land auto-tile corner set was found already present on
`forgotten_plains.png` (see `assets/README.md`) but correctly orienting all
eight directional pieces needs the same visual-verification step ROG-73
punted `Biomes_Merging_Tiles` on, so it's deferred rather than guessed at.

### Overworld scene atmosphere (ROG-65)

On top of the tilemap above, `OverworldSceneView` draws a second layer of
purely decorative treatment through a `createBlob()` primitive (a filled
ellipse, distinct from `createRect()` so it never disturbs the meter/minimap
rect ordering `overworldView.test.ts` counts on): a soft ground-shadow blob
under every mountain/forest/village/dungeonEntrance prop and the player
marker; a breathing glow halo behind village/dungeonEntrance markers; a
sparse, deterministically hash-selected subset of visible water tiles
glinting with a shimmer blob; and a small fixed-size pool (about a dozen) of
screen-space leaf/firefly particles that drift within the viewport, keyed to
whichever biomes are currently visible. All of it is time-driven by
`tick(deltaMs)`, wired once to the Pixi `Ticker` in `bootGame.ts` (the same
shape as `battleView.ts`'s `tick`), and fully stops - not just slows - when
`setReducedMotion(true)` is set from `bootGame.ts`'s
`prefers-reduced-motion` check. No `Math.random` anywhere: every
particle/shimmer/pulse's phase or position variety comes from the same
`Math.imul`-based hash `overworldVariants.ts` uses, so a render is always
reproducible.

## HUD chrome (ROG-47)


The frame (bordered panel + title), party bar (HP/MP meters + gold), and
message log around every scene are built once, framework-free, by
`buildChrome` in `src/ui/scene/chrome.ts` - the same function the terminal's
`Screen.tsx` and this renderer's `render/sceneView.ts` both walk. `buildChrome`
takes the available size in an abstract `Unit` (`src/ui/scene/tree.ts`) and
returns a `PanelNode` tree plus the drawable content-region size; neither the
builder nor the tree types ever see terminal columns or Pixi pixels directly.

`render/sceneView.ts`'s `UNIT_PX` constant is how many real pixels one chrome
`Unit` is worth for this renderer (1 unit = 1 terminal cell for Ink). Each
scene's `SceneChromeView` (built in `main.ts`) draws real filled-rect HP/MP
meters instead of the terminal's `█`/`░` glyph bars, and reuses every draw
object across renders by `node.key` so a dispatch that only changes HP/MP/log
mutates existing Pixi objects instead of rebuilding the chrome.

## Battle scene (ROG-51)

`render/battleView.ts`'s `BattleSceneView` is the Pixi counterpart of the
terminal's `BattleScreen.tsx` + `src/ui/screens/battle/{render,interaction}.ts`,
following the same framework-free-view-behind-a-`DrawFactory` split as the
overworld and HUD chrome above; `render/pixiBattleDrawFactory.ts`'s
`createPixiBattleDrawFactory` is the thin real-Pixi adapter. It draws one
sprite (or fallback rect) plus a name/HP plate per `BattleEnemy`, using the
terminal's own `packEnemyColumns` for layout, a target-mode selection
highlight, and the action/skill/item/target command menu the keyboard
manager is already driving. A `BattleEnemy` with no `sprite` id, or whose
`sprite` id isn't in the loaded atlas, always falls back to a solid rect
tinted the same as a real sprite would be - battles never break on a
missing sprite. Floating damage numbers and a brief hit-flash are derived
from HP deltas observed across successive `render()` calls (never from the
engine, which has no floating-combat-text concept and must stay pure) and
aged/removed by `BattleSceneView.tick(deltaMS)`, which `main.ts` wires to
the Pixi `Application`'s own `Ticker` once. Menu/cursor state is read from
the same `BrowserKeyboardManager` focus state (`getState().battle`) the
village content above already reads for its building focus - `handleBattle`
(ROG-45) already reduces that state machine and dispatches the resulting
battle events, so this view only needs to draw it.

## Dungeon scene (ROG-50)

`render/dungeonView.ts`'s `DungeonSceneView` is the Pixi counterpart of the
terminal's Braille-dot wireframe raycaster
(`src/ui/screens/dungeon/render.ts` + `braille.ts`). None of that glyph
output transfers, but the underlying model does - grid dungeon, discrete
position + facing, engine-side FOV - so this is a genuinely different
renderer: a classic textured DDA raycaster (Wolfenstein-style), following
the same framework-free-view-behind-a-`DrawFactory` split as the other
scenes; `render/pixiDungeonDrawFactory.ts`'s `createPixiDungeonDrawFactory`
is the thin real-Pixi adapter.

- **Raycasting core** - `render/dungeonRaycast.ts` is pure geometry, no
  `pixi.js` import (unit-tested in `dungeonRaycast.test.ts` against tiny
  synthetic layouts). `castWallColumns` casts one ray per `RAY_STRIP_PX` (4)
  viewport pixels via the standard "camera plane" method (a 66° FOV,
  `FOV_DEGREES`), so the resulting per-column distance is already
  perpendicular/fisheye-corrected without a separate `cos` division step.
  Rays are capped at `MAX_DEPTH` (8 tiles) - beyond that, a column reports
  `distance: Infinity` and a zero-height placeholder, so the returned array
  stays densely indexable by screen column (needed for billboard occlusion,
  below) even where nothing was hit. `castBillboards` projects every in-view
  `chest`/`stairsDown`/`bossMarker` feature the same way, culling anything
  behind the camera, beyond `MAX_DEPTH`, or occluded by a nearer wall at its
  own screen column - a single center-point distance test against
  `castWallColumns`'s output, matching the TUI renderer's own
  painter's-algorithm-level fidelity, not per-pixel clipping. One
  coordinate wrinkle worth knowing: the engine's grid treats tile `(x, y)`'s
  *center* as world position `(x, y)` itself, so every DDA computation is
  done in a position shifted by `+0.5` on both axes to match the DDA
  algorithm's usual `[x, x + 1)` tile convention - see the module doc
  comment.
- **Per-column wall texturing** - the point of a *textured* raycaster is
  that adjacent columns sample different horizontal texels of the wall
  tile, not `TEXELS_PER_TILE` squished copies of the whole thing.
  `pixiDungeonDrawFactory.ts` crops the atlas's `wall` frame into
  `TEXELS_PER_TILE` (12, the tile's native width) 1-texel-wide sub-`Texture`s
  once at setup time via Pixi's `frame` rectangle support, and
  `castWallColumns` outputs a texel index (`0..11`) per column; a wall
  column's `setTexel` just swaps between the cached textures - no per-frame
  texture allocation.
- **v1 scope decisions** - floor and ceiling are flat depth-independent
  colors (split at mid-screen), not per-pixel raycast/textured - the
  original Wolfenstein 3D's own approach, and still satisfies "reuse
  `DUNGEON_RAMPS` for distance fog/tinting" since walls carry the real
  per-column depth tint (`dungeonRamp(ds.dungeonId)`, same convention as the
  TUI). There is no move/turn tween - `poseFromState(ds)` renders directly
  every call; the issue explicitly allows instant movement for v1 since Pixi
  has no soft-real-time requirement here.
- **Minimap** - reuses the TUI's own pure `renderMinimap` glyph rows
  unmodified, mapped to small colored rects in a corner overlay (mirroring
  `OverworldSceneView`'s minimap, which is colored rects too, not sprites),
  plus a small facing-direction mark next to the player's cell.
- **Evac confirm (ENG-1)** - the one-line status readout (facing/boss/cleared)
  swaps to "Evac to the entrance? [y/n]" while the keyboard manager's
  `dungeon.confirmingExit` is set, mirroring the Ink `DungeonScreen`'s confirm
  prompt; `render()` takes that flag as an optional third argument.

### Adding the dungeon atlas frames

`wall`/`floor`/`chest`/`stairsDown`/`boss` were added to `ATLAS_FRAMES` in
`scripts/build-atlas.ts` for this scene (they already had tile coordinates
in `src/ui/tiles/sources.ts`'s `TILE_SOURCES`, just weren't packed into the
browser atlas yet).
Regenerate the same way as any other atlas change: `pnpm tsx
scripts/build-atlas.ts`, then commit the rewritten `public/atlas/atlas.png`
+ `atlas.json`.

## Title, village, and game-over (ROG-52)

`GameStore.state.scene` only ever holds `village | overworld | dungeon |
battle` - the terminal's title screen and game-over screen sit outside that,
as local UI state in `app.tsx` (`started`/`flags.gameOver`). `main.ts` mirrors
this with its own `Phase` (`"title" | "playing"`) plus the store's own
`flags.gameOver`, and shows exactly one of three things at a time: the title
container, the game-over container, or the normal scene switcher + chrome.

- **Title**: owns a `TitleUiState` and runs it through the same pure,
  renderer-agnostic `reduceTitleUi`/`resolveTitleIntent`
  (`src/ui/screens/title/interaction.ts`) the terminal's `app.tsx` uses - no
  duplicated menu/class/mode/name state machine. Its display data (block
  logo, main-menu entries) lives in `src/ui/screens/title/display.ts`, a pure
  module with no Ink/React import that `TitleScreen.tsx` also re-exports from,
  so both renderers draw the same content without either depending on the
  other's framework. The browser has no `SettingsScreen` yet, so selecting
  "Settings" is stashed (logged, matching the other not-yet-built stashes
  below) instead of opening a screen. `hasSave` now reflects whether the
  IndexedDB save slot held a game at boot (ROG-46, see "Persistence"
  below), so the Continue entry appears exactly when a save exists.
- **Game over**: drawn from `src/ui/screens/gameOverBanner.ts` (`BANNER`,
  extracted the same way as the title's `display.ts`), with Enter starting a
  new run (same class/permadeath, fresh seed, mirroring `app.tsx`) and `q`/
  ctrl+c returning to the title.
- **Village content**: the village scene's chrome-content region now draws
  real menu text for the overview and each building
  (inn/church/store/tavern), reading `BrowserKeyboardManager`'s existing focus
  state (`getState().village`) - the same state ROG-45 already used for input
  routing, now also driving what's on screen. Every menu (title, game-over,
  village) redraws by destroying and recreating its `Text` children each time
  rather than a keyed diff like the chrome's - these are small,
  infrequently-updated lists, not a hot path worth `SceneChromeView`'s
  abstraction.
- `BrowserKeyboardManager`'s `"quit"` global intent now calls the `onQuit`
  callback `main.ts` passes it (return to the title) instead of logging a
  stash - there is still no OS process to actually exit from a browser tab.
- **Fast travel (ENG-1)**: pressing `z` from the overworld/village opens the
  Zoom picker as a full overlay (`renderZoomOverlay` in `bootGame.ts`), reusing
  the village overview's bordered-panel + `drawLines` chrome and gated on the
  keyboard manager's `zoom.open` flag the same way `devConsoleOverlay` gates on
  `devConsole.isOpen()`. It lists every waypoint `world/waypoints.ts`'s
  `activatedWaypointList` reports for the save and dispatches `Zoom` on Enter.

## Persistence (ROG-46)

A single IndexedDB save slot, the browser counterpart to the terminal's
`node:sqlite` slot (`src/persistence/save.ts`) - same whole-state-JSON
format, same single-slot semantics, both sharing `src/persistence/
serializer.ts`'s `serialize`/`deserialize` so the save format stays
portable even though the store underneath differs per platform.

- `src/persistence/storage.ts`'s `SaveStorage` interface (`load`/`save`/
  `clear`, all `Promise`-returning, dealing only in the raw serialized JSON
  string) is the shared storage-backend contract. `src/persistence/
  sqliteStorage.ts`'s `SqliteSaveStorage` and `src/persistence/
  indexedDbStorage.ts`'s `IndexedDbSaveStorage` both implement it - the sqlite
  side is what `save.ts`'s long-standing sync `saveGame`/`loadGame`/
  `clearSave` build on (kept sync since `node:sqlite` has no async
  variant and every terminal caller/test depends on that), the IndexedDB
  side is async (IndexedDB has no sync API) and used only in the browser.
- `src/persistence/browserSave.ts` exposes async `loadGame`/`saveGame`/
  `clearSave` over a shared `IndexedDbSaveStorage`, the browser's
  counterpart to `save.ts`'s sync functions.
- `main.ts` awaits `loadGame()` at boot (unless `?fresh` is set, matching
  the terminal's `--fresh`) and constructs the initial `GameStore` from the
  loaded save if one exists, computing `hasSave` from that so the title
  menu's Continue entry appears correctly. A save that fails to load is
  logged and treated as no save, rather than crashing boot.
- `input/keyboard.ts`'s `handleChurch` calls the browser `saveGame`,
  mirroring `ChurchView.tsx`'s terminal save - fire-and-forget with a
  `Log` event once the write settles (async, unlike the terminal's sync
  save, so it doesn't block key handling), and flips `main.ts`'s `hasSave`
  to `true` on success via an `onSaved` callback.
- `main.ts` clears the browser save once `flags?.gameOver` goes true,
  mirroring `app.tsx`'s `useEffect(() => { if (gameOver) ... clearSave()
  })`, so the next boot or "New Game" starts fresh instead of reloading the
  dead run.
- Tested in `src/persistence/browserSave.test.ts` against
  `fake-indexeddb/auto`'s polyfill of the global `indexedDB` (the same
  global `IndexedDbSaveStorage` uses in a real browser) - round-trips a
  plain state and one with an active `dungeonState`, plus the empty/cleared
  cases, mirroring `save.test.ts`'s sqlite coverage.

## Scope and limits

This issue (ROG-43) only wires the build and boot sequence. ROG-44 adds the
texture atlas and an atlas-loading smoke test (see above), but real per-scene
sprite content is still out of scope. Also intentionally missing:

- Settings persistence - the browser has no `SettingsScreen` (see above),
  so unlike the terminal there is nothing to persist there yet; the save
  slot itself is implemented (see "Persistence" below).
- All four playing scenes now have real content - village (ROG-52),
  overworld (ROG-49), battle (ROG-51), and the dungeon (ROG-50, see above).
- Filing a Linear issue from the dev console's `issue`/`bug`/`flush`
  commands - those use `src/lib/linear.ts`'s Node `fs`/Vercel Connect I/O,
  which doesn't belong in a browser bundle; the console runs every other
  command and reports these as unavailable (see below).

## Dev console + crash screen (ROG-48)

`?dev` (mirroring the terminal's `--dev`) gates a plain-DOM dev console
overlay and enables the crash-overlay wiring below - a ponytail note on the
issue: a plain overlay div is enough for both, no need to build them in
Pixi.

- **Dev console** - `devConsole.ts`'s `BrowserDevConsole` owns open/input/
  output state and runs the exact same `runDevCommand` interpreter the
  terminal's `DevConsole.tsx` uses (extracted to
  `src/ui/screens/devConsoleCommands.ts` so this module doesn't import Ink),
  so every command (`help`, `state`, `debug`, `scene`, `log`, `recruit`,
  `crash`, `clear`) behaves identically under either renderer. `issue`/
  `bug`/`flush` are stashed - see "Scope and limits" above - the console
  reports "Issue filing isn't available in the browser yet." instead of
  touching Node-only I/O. `render/devConsoleOverlay.ts`'s
  `DevConsoleOverlayView` is the thin DOM glue that renders that state;
  `main.ts` intercepts backtick globally (open or closed) and routes every
  other key to `BrowserDevConsole.handleKeyDown` while it's open, mirroring
  `DevConsole.tsx`'s own raw-input handling rather than the shared `Keymap`/
  `resolveXIntent` screens use - the command line is unbounded free text.
  Unit-tested in `devConsole.test.ts` without a real DOM (this repo has no
  jsdom).
- **Crash screen** - `main.ts` subscribes to `store.subscribeIncidents` (the
  same engine-level incident pipeline the terminal's `FailureBoundary`/
  `IncidentPipeline` sit on top of) and shows `render/crashOverlay.ts`'s
  `CrashOverlayView` - the browser counterpart to the terminal's
  `CrashScreen.tsx` - for every fatal incident, with the incident's message,
  fingerprint, and the debug journal's tail, plus a Restart button that
  reloads the page. `window.onerror` and `unhandledrejection` listeners
  route otherwise-uncaught renderer failures through `store.reportFailure`
  the same way; the atlas/overworld/battle-view setup try/catches (ROG-43)
  now report through it too instead of the old plain-text `showCrash` stash
  (kept only for the one failure mode that has no `store` yet: constructing
  the initial `GameStore`). `renderCurrent` and the global keydown listener
  both check the current fatal incident first and skip everything else,
  mirroring the terminal's `if (fatal) return <CrashScreen/>`. This is
  intentionally simpler than the terminal's `IncidentPipeline` - no
  automatic Linear filing - since that pipeline's Node-only I/O doesn't
  belong in a browser bundle (see "Scope and limits" above).

## Chrome (ROG-54)

The Next.js app shell frames the canvas as a centred, fixed-aspect (3:2)
letterboxed **portal** - concept "The Portal": a dark scrying chamber whose
palette is lifted straight from the game's own `src/ui/theme.ts` so the frame
reads as the same artifact as the game.

- `app/layout.tsx` - `<html>`/`<body>` + `globals.css` + page metadata.
- `app/page.tsx` - the chrome: pink->purple wordmark, tagline, the portal
  frame (indigo border, amber corner brackets, glow) and the controls legend.
  All static furniture; the game owns real input.
- `app/GamePortal.tsx` - the `#portal` mount. Its `useEffect` lazily
  `import()`s `bootGame` (so Pixi/engine/IndexedDB code is never evaluated
  during the static export) and disposes the returned handle on unmount.
- The Pixi `Application` uses `resizeTo: <the portal element>`, so the game
  world scales to the portal, never the whole window. The crash overlay, dev
  console (`?dev`), and minimum-size notice are all scoped to the portal
  (`position: absolute` inside it) rather than the viewport.

## Deployment

The game ships as part of one Vercel deployment shared with the `eve` agent, and
**this Next.js app is the host**. `next.config.mjs` wraps the config with
`withEve` from `eve/next`, pointing `eveRoot` at the repo-root `agent/`. That
mounts the agent at `/eve/v1/*`:

- **On Vercel**, `withEve` writes a Build Output `eve` *service* (which runs
  `eve build` for the agent) plus a route sending `/eve/v1/**` to it ahead of
  filesystem routing. Next stays the default app, so `/` serves the game (and
  `/_next/*` and `/atlas/*` its assets), while `/eve/v1/*` and
  `/.well-known/workflow/*` reach eve. One project, same origin, no CORS.
- **Locally**, `withEve` boots an `eve dev` server beside `next dev` (and
  `next build`/`next start`) and rewrites `/eve/**` to it.

`src/web` is a pnpm workspace package (`@ts-rogue/web`) so Vercel detects it as a
Next.js project: set the Vercel project **Root Directory to `src/web`**. Vercel's
"Include files outside the root directory" (default on) makes the repo-root
`agent/` available to the generated eve service build. There is no static export
and no merge script - Next owns runtime routing.

### The TypeScript toolchain the Next build needs

The `typescript` package is **stable v5** (not the TypeScript 7 native preview),
because Next's build loads the TypeScript compiler API - which the native
preview does not expose, so Next would otherwise try to "fix" it by silently
downgrading `typescript`. To keep the native preview's typecheck speed, the
preview is installed under its own name, `@typescript/native-preview` (the
`tsgo` binary), and `pnpm typecheck` runs `tsgo --noEmit`. So: stable
`typescript` satisfies Next + editors + the language service, `tsgo` is the fast
checker of record, and the whole app - chrome included - is normal `.tsx`.
`next.config.mjs` is plain JS only so Next never has to transpile a `.ts` config
with whichever compiler is active.

## Harness data-access routes (HAR-50)

`app/api/harness/sessions/route.ts` and `app/api/harness/sessions/[id]/route.ts`
are plain Next.js route handlers - server-only, sharing this app's single
Vercel deployment (not part of the `/eve/v1/*` agent surface). They read the
Vercel Workflow run tags eve writes on every session/turn/subagent run
(`$eve.root`, `$eve.parent`, `$eve.type`, ...; see
`node_modules/eve/docs/guides/instrumentation.md#workflow-run-tags`) through
`POST /v2/observability/query`, the same Vercel operation
`agent/connections/vercel-api.ts` allows - reimplemented as a direct
server-side `fetch` (`lib/harness/vercelObservability.ts`) rather than
imported, since that connection compiles into the agent's tool-calling
surface, not into this Next app.

Both routes deny every caller with a 401 (`lib/harness/authz.ts`) until HAR-54
lands a real superadmin check derived from Auth.js sessions - `VERCEL_TOKEN`
never reaches an unauthorized caller because the gate runs before any Vercel
call. Behind the gate, `lib/harness/sessions.ts` queries recent runs, maps
rows to `HarnessRunRecord`s (`lib/harness/runRecords.ts`), and groups them
into a session list or one session's subagent tree
(`lib/harness/grouping.ts`). A query failure - including a `402` when the
team lacks Observability Plus, which is the current state for this project's
Vercel team - degrades to `{ unavailable: true, reason }` instead of a 500.

`$eve.*` names a run's parent and root but never its own id, and grouped
queries collapse rows sharing every grouped dimension, so the subagent tree
is two levels (the root session's own turns, aggregated, plus one node per
distinct subagent role) rather than an arbitrary-depth run graph. The exact
`groupBy`/response shape is unverified against live tagged data pending
Observability Plus; see the code comments in `lib/harness/eveTags.ts` and
`lib/harness/vercelObservability.ts` before changing them.
