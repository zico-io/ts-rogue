---
"ts-rogue": minor
---

Overworld terrain auto-tile stand-in in the browser renderer (ROG-73): a
water tile bordering land now grows a sand-tinted shore fringe along its
land-adjacent edge(s); a mountain tile swaps to a genuinely smaller/larger
same-family rock crop as its same-type neighbor density changes (not just a
rescale) and scales up with that density, same as forest tiles; and
village/dungeonEntrance landmarks get a small deterministic per-instance
size variation. Pure, unit-tested. The two new mountain crops are
color-matched picks from the already-vendored `forgotten_plains.png`
tileset; a real cross-biome shore/corner bitmask tileset is a documented
follow-up (the vendored packs don't ship one with a usable legend). Terminal
renderer (`pnpm game`) is pure ASCII and unaffected.
