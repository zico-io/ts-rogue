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
- `main.ts` - the entry point: builds the initial `GameState`, wires a
  `GameStore`, initializes the Pixi `Application`, builds one `Container` per
  scene, loads the atlas, wires the keyboard manager, and subscribes to store
  updates.
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
  duplicated here. Unit-tested in `input/keyboard.test.ts`.
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

## Scope and limits

This issue (ROG-43) only wires the build and boot sequence. ROG-44 adds the
texture atlas and an atlas-loading smoke test (see above), but real per-scene
sprite content is still out of scope. Also intentionally missing:

- Persistence - every load starts a fresh game; the Church's save and the
  dev-console/quit global bindings are stashed (logged, not implemented)
  until ROG-46 adds IndexedDB save/load.
- Real scene content - each scene is a placeholder label (plus, since
  ROG-44, a static atlas preview in the village scene); ROG-49 through
  ROG-52 add real sprites and per-scene rendering, including a visible focus
  indicator for the keyboard manager's routing (ROG-45).
- The title flow - the browser has no title scene yet, so `quit` is stashed
  and boots straight past it; ROG-52 wires the title flow in.
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
