---
"ts-rogue": minor
---

Story dungeons now scale loot by floor band (ROG-92): each `DungeonDef`'s
`floorBands` (src/data/dungeons.ts) already pointed at a tiered loot table
per floor range, and that ref is now actually wired into loot resolution.
Both battle victory loot and chest loot look up the current floor's band and
draw from its table via the existing `weightedPick` path in
`src/engine/loot/resolution.ts`, instead of the killed monster's own fixed
tier or a floor-global chest table - so a deeper floor in the same dungeon
drops from a higher-ilvl table than a shallow one. No new loot tables or
machinery were added; this only wires refs that already existed.
