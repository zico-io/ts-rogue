---
"ts-rogue": minor
---

Multi-tile landmark support in the overworld (ENG-7): the village now
occupies a 2x2 footprint instead of a single tile. `engine/world/landmarks.ts`
derives the footprint from the village's anchor cell plus a fixed size
lookup at generation time (never stored redundantly per cell) and rejects a
footprint that would overlap impassable terrain or another landmark. Every
covered cell carries the `village` tile, so movement, passability, and the
village-entry trigger all work unchanged from any of the four cells.

Both renderers draw the footprint as one coherent structure instead of a
repeated single glyph/sprite: the Ink TUI (`pnpm game`) renders four distinct
ASCII glyphs - a peaked roof over a walled door and window - and the PixiJS
renderer (`pnpm web:dev`) tiles four contiguous per-cell texture sub-regions
using the multi-cell texture mapping from ENG-8, with the ground-shadow and
pulse halo drawn once for the whole footprint instead of once per cell.
Dungeon entrances remain single-tile landmarks.
