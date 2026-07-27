---
"ts-rogue": minor
---

Overworld tile selection and readability in the PixiJS renderer (WEB-6,
follow-up to ROG-65/ROG-73 reviewer feedback that the world still looked
noticeably worse than the Tiny Overworld reference). Audited every
`TILE_SOURCES` crop against the vendored `forgotten_plains.png` /
`overworld_props.png` sheets pixel-by-pixel:

- The `grass` crop was clipping a neighboring rock formation's gray shading
  into every grass tile; it now points at a clean, fully-opaque solid-green
  crop from the same sheet.
- The `water` crop was only ~62% water pixels (the rest muddy shoreline
  bleed from the sheet's small illustrated ponds); it now uses the largest
  pure-water strip in either pond, which the atlas's existing nearest-neighbor
  resize doubles into a full clean 8x8 tile.
- Grass tiles get sparse, deterministic ground clutter (`grassTuft`,
  `grassFlowerYellow`, `grassFlowerPink`, `grassPebble` - small self-contained
  icons from the same props sheet the tree comes from) via a new
  `grassDecoration(x, y)` selector, so a field of grass reads as more than one
  repeated tile without touching the camera/viewport math or the biome/token
  model.

A genuine cross-biome shore/corner auto-tile blend (the sheet's diagonal
water/land transition pieces) is identified but deferred to a follow-up -
correctly orienting eight directional pieces needs the same visual-verification
step the team already punted `Biomes_Merging_Tiles` on in ROG-73. Terminal
renderer (`pnpm game`) is pure ASCII and unaffected.
