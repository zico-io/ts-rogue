---
"ts-rogue": minor
---

Browser renderer (ROG-72): the title/main menu screen now draws inside the
same beveled-navy-fill-inside-an-amber-frame windowskin panel every in-game
scene already gets from `SceneChromeView`, instead of bare text on a plain
black canvas - logo, menu/class/mode/name content and behavior are unchanged.
Also removed a leftover ROG-44 atlas smoke-test overlay (`showAtlasPreview`)
that drew an oversized grass/wall tile pair and a debug label into the
village scene's content container on every boot and was never cleared,
leaving a stray tile-and-label overlay behind the real village HUD. Terminal
renderer (`pnpm game`) is unaffected.
