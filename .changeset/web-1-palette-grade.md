---
"ts-rogue": minor
---

Palette contrast and tile readability in the PixiJS renderer (WEB-1, ROG-67
art direction §3/§2.4): overworld biome tokens (grass/forest/mountain/water)
are warmer and more saturated so the world reads sunlit instead of washed,
and `DUNGEON_RAMPS` is re-anchored from the old teal/indigo/ember zone-tint
trio to a torch-warm-near -> cool-dark-far depth fog (>=7.9:1 near-vs-far
luminance contrast on every dungeon, comfortably past the >=3:1 target). A
new whole-frame Pixi `ColorMatrixFilter` palette-lock grade (subtle warm hue
push + saturation bump) is applied to `app.stage` in `bootGame.ts` so every
scene, including the Aekashics battle sprites, reads as one graded world.
The Minifantasy tile atlas build (`scripts/build-atlas.ts`) now bakes in a
matching import-time grade (warmth/saturation/local contrast via `sharp`) so
atlas tiles read distinctly at a glance. Terminal renderer (`pnpm game`) is
unaffected except for the biome token hex values, which only get more
legible (contrast against the terminal's implicit black background improves
for all four biomes).
