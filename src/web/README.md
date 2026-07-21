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
- `main.ts` - the entry point: builds the initial `GameState`, wires a
  `GameStore`, initializes the Pixi `Application`, builds one `Container` per
  scene, and subscribes to store updates.
- `index.html` - the Vite HTML entry, a full-viewport canvas mount plus a
  hidden minimum-size overlay.

## Scope and limits

This issue (ROG-43) only wires the build and boot sequence. It intentionally
does not yet include:

- Persistence - every load starts a fresh game; ROG-46 adds IndexedDB
  save/load.
- Keyboard input - nothing dispatches events yet; ROG-45 adds a keyboard input
  manager with scene focus routing.
- Real scene content - each scene is a placeholder label; ROG-49 through
  ROG-52 add real sprites and per-scene rendering.
- A dev console or rich crash screen - failures show a minimal plain-text
  overlay; ROG-48 owns a proper browser dev console and crash screen.
