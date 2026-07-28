# World

Overworld, village, and dungeon-entrance facts: navigation, landmarks, and
tier placement. Part of the golden product SSOT (see
`.botfile/memory/index.md`); `pnpm docs:lint` reports drift.

- The overworld/village support fast travel: evac exits any dungeon (outside battle) to the overworld on the entrance tile with dungeon progress untouched, and zoom teleports between landmarks (village, dungeon entrances) already visited this run; neither triggers an encounter or resets the overworld danger meter. <source: src/engine/world/waypoints.ts and src/engine/state/store.ts, 2026-07-25>
- The village is a multi-tile landmark: it occupies a 2x2 footprint derived from its anchor cell (`map.village`) plus a fixed size lookup, not stored per-cell. Both renderers draw it as one coherent structure - the Ink TUI with four distinct ASCII glyphs, the PixiJS renderer with one contiguous sprite tiled from per-cell texture sub-regions - and it stays enterable and non-overlapping with other terrain/landmarks from any of its four cells. <source: src/engine/world/landmarks.ts, src/ui/screens/overworld/render.ts, and src/web/render/overworldView.ts, 2026-07-26>
- The overworld's 3 fixed dungeon entrances are each bound to one of the curated story dungeons (`DUNGEONS` in `src/data/dungeons.ts`), ordered so tier ascends with chebyshev distance from the village: the nearest entrance leads to the lowest-tier dungeon. `dungeonWaypointId(entranceIndex)` resolves to the story dungeon's id (falling back to a generic id if an entrance has no matching def), so entering an entrance, its waypoint, and its generated dungeon layout all key off the same id. <source: src/engine/world/overworld.ts and src/engine/world/waypoints.ts, 2026-07-27>
