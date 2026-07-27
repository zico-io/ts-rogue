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

export function lootTableForTier(tier: number): LootTable {
  if (tier <= 1) return findLootTable("tier-1") as LootTable;
  if (tier === 2) return findLootTable("tier-2") as LootTable;
  return findLootTable("tier-3") as LootTable;
}

export function tierForFloor(floor: number): number {
  if (floor <= 1) return 1;
  if (floor === 2) return 2;
  return 3;
}

export function chestLootTableFor(floor: number): LootTable {
  const tier = tierForFloor(floor);
  if (tier === 1) return findLootTable("chest-1") as LootTable;
  if (tier === 2) return findLootTable("chest-2") as LootTable;
  return findLootTable("chest-3") as LootTable;
}

// Chest tables mirror the "tier-N" reward tables 1:1 as "chest-N" - the
// convention every DungeonFloorBand.lootTableRef already follows.
export function chestLootTableForRef(lootTableRef: string): LootTable {
  const chestId = lootTableRef.replace(/^tier-/, "chest-");
  return findLootTable(chestId) ?? chestLootTableFor(1);
}
