# Product

Golden product SSOT: the distilled, current truth of *shipped* ts-rogue behavior.
Upsert facts here (delete what shipped past); keep provenance and dates current.
`pnpm docs:lint` reports drift.

- ts-rogue is a replayable terminal dungeon crawler whose loop runs village, overworld, dungeon, battle, loot, and back to village. <source: PROJECT_PLAN.md and src/engine/world, 2026-07-23>
- The runtime is TypeScript on Node.js 24+ with Ink for the terminal UI, rot.js for procedural generation, seeded randomness, and a central serializable reducer store. <source: package.json and src/engine/state/store.ts, 2026-07-23>
- Engine modules must never import UI modules; the boundary is enforced by a biome rule. <source: biome.json and src/engine/README.md, 2026-07-23>
- Play is party-based: a multi-member party fights in battle, not a single hero. <source: src/engine/state/types.ts and src/engine/combat/resolution.ts, 2026-07-23>
- Characters have classes (warrior, rogue, wizard) that carry distinct skills and stats. <source: src/data/classes.ts and src/engine/combat/skills.ts, 2026-07-23>
- Loot is generated from item bases, affixes, and monster-implicit pools rather than hand-authored drops. <source: src/engine/loot and src/data/itemBases.ts, 2026-07-23>
- The first-person dungeon view renders perspective-projected wall faces and interactables as Braille wireframes. <source: src/ui/screens/dungeon/render.ts, 2026-07-23>
- The terminal UI ships a visual identity: a shared theme-token palette and an image tileset overlay. <source: src/ui/README.md and src/ui/tiles, 2026-07-23>
- Game state persists to a serializable save so runs resume across sessions. <source: src/persistence/save.ts, 2026-07-23>
- Linear owns issue status and priority; durable product truth lives in the repository. <source: CONTRIBUTING.md, 2026-07-23>
- The overworld/village support fast travel: evac exits any dungeon (outside battle) to the overworld on the entrance tile with dungeon progress untouched, and zoom teleports between landmarks (village, dungeon entrances) already visited this run; neither triggers an encounter or resets the overworld danger meter. <source: src/engine/world/waypoints.ts and src/engine/state/store.ts, 2026-07-25>
- A dedicated Inventory screen (`v` key, village/overworld/dungeon) manages gear (equip/unequip/sort/full-affix inspect), consumables (field use outside battle), gold, and the loot filter; the village Store's backpack view now only sells. <source: src/ui/screens/InventoryScreen.tsx and src/ui/screens/village/StoreView.tsx, 2026-07-25>
- The field backpack for generated gear is capped at 20 instances; excess storage lives in the village Stash (unlimited), reachable from the village overview. <source: src/engine/loot/inventory.ts and src/ui/screens/village/StashView.tsx, 2026-07-25>
- An opt-in loot filter auto-dismantles field drops for gold when they fail a rarity floor, an ilvl-vs-party-level floor, and carry none of the player's kept affix stats; a drop that would overflow the field backpack instead raises a mandatory swap-or-dismantle prompt. <source: src/engine/loot/lootFilter.ts and src/engine/loot/pickup.ts, 2026-07-25>
