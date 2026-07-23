---
"ts-rogue": minor
---

Next.js portal chrome around the web game (ROG-54): the PixiJS renderer now
boots inside a Next.js app shell that frames the canvas as a centred,
fixed-aspect (3:2) letterboxed "portal" into the dungeon world - a dark scrying
chamber with a pink->purple wordmark, controls legend, and an amber/indigo
bezel, all drawn from the game's own `theme.ts` palette - instead of a raw
full-viewport canvas. `main.ts` becomes an exported `bootGame(mount, flags)`
with a `dispose()` handle (React-mount safe); the crash/dev-console/min-size
overlays are scoped to the portal. Ships as a static export (`output: "export"`)
merged into eve's Vercel output exactly as the old Vite build was. Toolchain:
stable `typescript@5` for the Next build plus `@typescript/native-preview`
(`tsgo`) for the fast typecheck of record.
