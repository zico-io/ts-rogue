---
"ts-rogue": minor
---

Game wiki at `/help` in the web app, built on the licensed beUI Pro
`knowledge-help-center` block: topic cards, full-text search across articles,
and an accessible reading dialog, seeded with 14 articles covering the run
loop, classes and controls, battle actions, elements and status effects, skill
target shapes, defeat and permadeath, overworld travel, evac/zoom, dungeon
floors, skill trees, the Guild quest board, loot, and saving. The portal
masthead now links to it.

This also stands up shadcn + Tailwind v4 in `src/web` for the first time.
Tailwind is scoped to the wiki route - `app/help/help.css` is imported by
`app/help/layout.tsx`, not the root layout - so its preflight reset ships only
in the `/help` chunk and the game page keeps its hand-written `globals.css`
untouched. The wiki's theme tokens map onto the game's own chamber palette.

Two fixes carried along: the installed `TabsTrigger` primitive dropped every
prop it did not name, which broke the help center's roving-tabindex topic tabs
(and failed the typecheck), and `pnpm lint` failed whenever the eve dev server
had run because biome scanned the gitignored `agent/.eve/` runtime directory.
