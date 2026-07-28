---
"ts-rogue": minor
---

Added Drowned Temple, a 4th story dungeon (ROG-95), purely as one
`DungeonDef` entry (tier 4, 6 floors, recommended level 15) plus its own
message-log flavor and first-person color ramp - no other `src/engine`
change was needed to make it playable. This closed one real gap in the
extensibility contract: the overworld's entrance count was a hardcoded `3`
that happened to match the 3 existing story dungeons rather than actually
deriving from the `DUNGEONS` table, so it now reads `DUNGEONS.length`
(`src/engine/world/overworld.ts`) and a future story dungeon gets a placed
entrance for free.

A new deterministic test walks the real overworld -> enter -> descend (all
6 floors) -> boss -> clear loop for Drowned Temple and asserts
`allStoryDungeonsCleared` only flips true once every story dungeon
(including it) has a `clearedAt` record - the exact boolean ROG-28's
endgame trigger will consume.
