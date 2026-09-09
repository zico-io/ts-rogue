---
"ts-rogue": minor
---

The browser now plays the real game. `src/web` runs the Ink terminal app in a
PTY and streams it to [wterm](https://github.com/vercel-labs/wterm), replacing
the ~9.4k-line PixiJS renderer that re-drew every screen in WebGL. The web
build and the CLI are now the same program, so `?seed=1&fresh` in a browser is
the same run as `pnpm game:dev --seed=1 --fresh`, and a UI change lands in both
places at once. Each connection gets its own game process and save file.

`pnpm web:dev` now starts a custom server; a deployed build serves the page but
has no PTY host behind it until a Sandbox backend lands.
