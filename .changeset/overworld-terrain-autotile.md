---
"ts-rogue": minor
---

Overworld terrain auto-tile stand-in in the browser renderer (ROG-73): a
water tile bordering land now grows a sand-tinted shore fringe along its
land-adjacent edge(s), mountain and forest tiles scale up with their local
same-type neighbor density instead of always drawing at a fixed size, and
village/dungeonEntrance landmarks get a small deterministic per-instance
size variation. Pure, unit-tested, and code-only (no new source art vendored
yet - the crop of the Tiny Overworld sheet is a small preview swatch, not a
full autotile blob sheet). Terminal renderer (`pnpm game`) is pure ASCII and
unaffected.
