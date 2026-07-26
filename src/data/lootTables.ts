/**
 * Loot table definitions (PROJECT_PLAN Phase 5, ROG-11; data table named in
 * section 7). Per-enemy-tier trash tables, the boss table, and per-floor chest
 * tables, all the same weighted shape. `dropChance` is the base-tier roll (does
 * anything drop?); on a drop a rarity is rolled from `rarityWeights` and a base
 * is picked from `items`. Deeper tiers and the boss table favor rarer rolls and
 * reference higher-ilvl bases. The combat victory hook selects a monster's
 * table via its `lootTableRef`; the chest hook selects via floor.
 *
 * Phase 6 (ROG-12) balance pass: the tier-1 (slime) trash dropChance was raised
 * from 0.25 to 0.30 so early kills feel a bit more rewarding. Tier-2 (0.30),
 * tier-3/boss (1.0), and all chest tables (1.0) are unchanged. Monster-implicit
 * pool drop chances stay infrequent for type pools and reliable for boss pools
 * by design (see `src/data/implicitPools.ts`).
 */

import type { LootTable } from "../engine/loot/types";

export const LOOT_TABLES: readonly LootTable[] = [
  {
    id: "tier-1",
    dropChance: 0.3,
    rarityWeights: { common: 60, magic: 30, rare: 9, unique: 1 },
    items: [
      { baseId: "rusty-dagger", weight: 3 },
      { baseId: "tunic", weight: 3 },
      { baseId: "copper-ring", weight: 2 },
    ],
  },
  {
    id: "tier-2",
    dropChance: 0.3,
    rarityWeights: { common: 50, magic: 34, rare: 14, unique: 2 },
    items: [
      { baseId: "iron-sword", weight: 2 },
      { baseId: "leather-vest", weight: 2 },
      { baseId: "silver-pendant", weight: 2 },
      { baseId: "rusty-dagger", weight: 1 },
    ],
  },
  {
    id: "tier-3",
    dropChance: 1,
    rarityWeights: { common: 25, magic: 40, rare: 30, unique: 5 },
    items: [
      { baseId: "war-blade", weight: 2 },
      { baseId: "plate-mail", weight: 2 },
      { baseId: "silver-pendant", weight: 1 },
      { baseId: "iron-sword", weight: 1 },
    ],
  },
  {
    id: "chest-1",
    dropChance: 1,
    rarityWeights: { common: 50, magic: 35, rare: 13, unique: 2 },
    items: [
      { baseId: "tunic", weight: 3 },
      { baseId: "copper-ring", weight: 3 },
      { baseId: "rusty-dagger", weight: 2 },
    ],
  },
  {
    id: "chest-2",
    dropChance: 1,
    rarityWeights: { common: 40, magic: 38, rare: 19, unique: 3 },
    items: [
      { baseId: "iron-sword", weight: 2 },
      { baseId: "leather-vest", weight: 2 },
      { baseId: "silver-pendant", weight: 2 },
      { baseId: "copper-ring", weight: 1 },
    ],
  },
  {
    id: "chest-3",
    dropChance: 1,
    rarityWeights: { common: 25, magic: 40, rare: 30, unique: 5 },
    items: [
      { baseId: "war-blade", weight: 2 },
      { baseId: "plate-mail", weight: 2 },
      { baseId: "silver-pendant", weight: 2 },
    ],
  },
];

export function findLootTable(id: string): LootTable | undefined {
  return LOOT_TABLES.find((table) => table.id === id);
}

/** Loot table for a given monster tier (trash tiers 1-2, boss tier 3+). */
export function lootTableForTier(tier: number): LootTable {
  if (tier <= 1) return findLootTable("tier-1") as LootTable;
  if (tier === 2) return findLootTable("tier-2") as LootTable;
  return findLootTable("tier-3") as LootTable;
}

/**
 * Map a dungeon floor number to its tier (1 = shallow, 3+ = deep/boss). The
 * single source of truth for this cutoff - `chestLootTableFor` below and the
 * loot filter's `LootFilterContext.dungeonTier` (`engine/loot/lootFilter.ts`)
 * both derive from this so the two conventions can't drift apart.
 */
export function tierForFloor(floor: number): number {
  if (floor <= 1) return 1;
  if (floor === 2) return 2;
  return 3;
}

/** Chest loot table for a dungeon floor (deeper floors roll better tables). */
export function chestLootTableFor(floor: number): LootTable {
  const tier = tierForFloor(floor);
  if (tier === 1) return findLootTable("chest-1") as LootTable;
  if (tier === 2) return findLootTable("chest-2") as LootTable;
  return findLootTable("chest-3") as LootTable;
}
