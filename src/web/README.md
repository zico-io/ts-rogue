# Browser renderer

A PixiJS renderer that boots the same engine core (`src/engine`) the Ink
terminal renderer (`src/app.tsx`, `src/ui`) uses, driven by a plain browser
entry point instead of a terminal.

## Running

```bash
pnpm web:dev
```

Open the printed local URL. Boot query params mirror the terminal's CLI flags:

| Param | Terminal equivalent | Effect |
| --- | --- | --- |
| `?seed=123` | `--seed=123` | Seeds the new run; defaults to `Date.now()` |
| `?fresh` | `--fresh` | Presence-only; no browser persistence exists yet, so this is currently a no-op |
| `?dev` | `--dev` | Presence-only; stashed for a future dev console, no effect yet |

`pnpm web:build` produces a static bundle in `dist/web`; `pnpm web:preview`
serves that build locally.

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
  terminal. Draws the panel border/title, real filled-rect HP/MP meters
  (replacing the terminal's glyph bars), and the message log tail, keeping
  every draw object keyed by `node.key` so a dispatch only updates what
  changed instead of rebuilding the chrome. Framework-free (no `pixi.js`
  import) behind a `DrawFactory` interface, so it's unit-tested in
  `sceneView.test.ts` without a real WebGL/canvas context.
- `render/pixiDrawFactory.ts` - `createPixiDrawFactory`: the thin adapter that
  implements `sceneView.ts`'s `DrawFactory` with real Pixi `Graphics`/`Text`
  objects added to a given container. Not unit-tested (thin Pixi glue, like
  `atlas.ts`).
- `main.ts` - the entry point: builds the initial `GameState`, wires a
  `GameStore`, initializes the Pixi `Application`, builds one `Container` per
  scene plus its `SceneChromeView` and content sub-container, loads the atlas,
  wires the keyboard manager, and owns the title/game-over `Phase` on top of
  the store's own scenes (see "Title, village, and game-over" below). A single
  `renderCurrent()` redraws whatever should be visible - called from
  `store.subscribe` (a `GameStore` dispatch), the Pixi renderer's `resize`
  event, and after every keydown, since menu-cursor moves and other local-only
  UI state don't dispatch a `GameEvent` and would otherwise never redraw.
- `input/normalizeBrowserKey.ts` - normalizes a DOM `KeyboardEvent` (or the
  minimal `{ key, ctrlKey, metaKey }` shape tests construct) to the same
  `KeyName` alphabet `normalizeInkKey` produces for the terminal. Pure,
  unit-tested in `input/normalizeBrowserKey.test.ts`.
- `input/keyboard.ts` - `BrowserKeyboardManager` (ROG-45): a `keydown`
  listener wired in `main.ts` that resolves the global scene-hotkey/
  dev-console/quit keymap first, then routes to whichever scene - and,
  inside the village, whichever sub-view (overview/inn/church/store/tavern)
  - currently has focus, via the exact same `interaction.ts` modules under
  `src/ui/screens/**` the Ink renderer uses. No keymap or reducer logic is
  duplicated here. `main.ts` only calls into it while the game is being
  played (not during the title flow or a game-over screen; see below) and
  passes it an `onQuit` callback (ROG-52) that returns to the title screen.
  Unit-tested in `input/keyboard.test.ts`.
- `index.html` - the Vite HTML entry, a full-viewport canvas mount plus a
  hidden minimum-size overlay.
- `public/atlas/` - the built atlas (`atlas.png` + `atlas.json`), served
  as-is by Vite's default static-file handling for `<root>/public`
  (`vite.config.ts` sets `root: "src/web"`) and copied verbatim into
  `dist/web/atlas/` on build. Generated; do not hand-edit, see below.

## Art pipeline (ROG-44)

Style: 12x12 pixel art from the [Urizen 1-bit tileset](../../assets/README.md)
(`assets/urizen_onebit_tileset__v2d0.png`), the same source the terminal's
kitty-graphics tileset uses (`src/ui/tiles/kitty.ts`). Colors come from the
ROG-31 palette in `src/ui/theme.ts`; the art itself is monochrome pixel art
tinted only by each monster's `color` in battle framing, not by the tile
atlas.

`scripts/build-atlas.ts` slices named tile coordinates out of the sheet and
packs them into one Pixi spritesheet (`atlas.png` + `atlas.json`, hash
format) under `public/atlas/`. Frames stay at native 12x12 - Pixi scales
pixel art at render time with nearest-neighbor filtering
(`texture.source.scaleMode = "nearest"`) instead of baking a pre-scaled
sprite, unlike the terminal pipeline which pre-scales monster glyphs 8x for
fixed-size kitty placements.

`atlas.ts`'s `loadAtlas()` registers the bundle with `Assets.addBundle` and
awaits `Assets.loadBundle`, returning a `Spritesheet` whose `textures` map is
keyed by frame name. `main.ts` looks sprites up by name, e.g.
`sheet.textures.slime`.

### Adding a new sprite

1. Pick (or add) the tile's `(col, row)` coordinate on the Urizen sheet and
   add it to `TILE_SOURCES` in `src/ui/tiles/kitty.ts` if it is not already
   there (the terminal and browser pipelines share this table).
2. Add the same name to `ATLAS_FRAMES` in `scripts/build-atlas.ts`.
3. Regenerate the atlas: `pnpm tsx scripts/build-atlas.ts`. This rewrites
   `public/atlas/atlas.png` and `atlas.json` - commit both.
4. For a monster, set `sprite: "<name>"` on its `MonsterDef` in
   `src/data/monsters.ts` (additive, alongside `ascii`; the terminal renderer
   keeps using `ascii` unchanged). It carries through to `BattleEnemy.sprite`
   in battle state automatically via `src/engine/combat/resolution.ts`.
5. Look the texture up wherever it renders: `const sheet = await
   loadAtlas(); new Sprite(sheet.textures["<name>"])`, and set
   `texture.source.scaleMode = "nearest"` before scaling it up.

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
  other's framework. The browser has no save persistence yet (ROG-46) or
  `SettingsScreen`, so `hasSave` is always `false` (no "Continue" entry) and
  selecting "Settings" is stashed (logged, matching the other not-yet-built
  stashes below) instead of opening a screen.
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

## Scope and limits

This issue (ROG-43) only wires the build and boot sequence. ROG-44 adds the
texture atlas and an atlas-loading smoke test (see above), but real per-scene
sprite content is still out of scope. Also intentionally missing:

- Persistence - every load starts a fresh game; the Church's save and the
  dev-console global binding are stashed (logged, not implemented) until
  ROG-46 adds IndexedDB save/load and ROG-48 adds a browser dev console.
- Real dungeon scene content - it is still a placeholder label (plus, since
  ROG-44, a static atlas preview in the village scene) drawn inside the
  ROG-47 chrome's content region; ROG-50 owns its real sprites and per-scene
  rendering, including a visible focus indicator for the keyboard manager's
  routing (ROG-45). The village scene's content is real as of ROG-52, and
  the overworld's (ROG-49) and battle's (ROG-51) as of the sections above.
- A dev console or rich crash screen - failures show a minimal plain-text
  overlay; ROG-48 owns a proper browser dev console and crash screen.

## Deployment

The root `vercel.json` builds this renderer as a static site: `pnpm web:build`
into `dist/web`, served with a catch-all rewrite to `index.html` for any
future client-side routes. Link the repository with `vercel link` (or import
it in the Vercel dashboard) and it deploys with no further configuration;
`vercel.json`'s `buildCommand`/`outputDirectory` override any framework
auto-detection since the Vite root lives under `src/web` rather than the
repository root.
