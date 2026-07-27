import { dungeonDefFor, floorBandFor } from "../../data/dungeons";
import { findImplicitPool } from "../../data/implicitPools";
import { findItemBase } from "../../data/itemBases";
import {
  chestLootTableFor,
  chestLootTableForRef,
  findLootTable,
} from "../../data/lootTables";
import { findMonster } from "../../data/monsters";
import type { Rng } from "../rng/rng";
import { rollAffixes, rollImplicitAffix } from "./affixes";
import type {
  ItemInstance,
  LootRollResult,
  LootTable,
  MonsterImplicitPool,
  Rarity,
  RarityWeights,
  WeightedItemRef,
} from "./types";

export const DEFAULT_RARITY_WEIGHTS: RarityWeights = {
  common: 60,
  magic: 30,
  rare: 9,
  unique: 1,
};

export interface LootEnemy {
  defId: string;
  hp: number;
}

// Identifies the current dungeon floor so loot resolution can draw from that
// floor band's tiered table instead of a monster- or floor-global default.
export interface DungeonLootContext {
  dungeonId: string;
  floor: number;
}

function dungeonLootTableRef(
  context: DungeonLootContext | undefined,
): string | undefined {
  if (!context) return undefined;
  return floorBandFor(dungeonDefFor(context.dungeonId), context.floor)
    .lootTableRef;
}

function weightedPick<T extends { weight: number }>(
  rng: Rng,
  entries: readonly T[],
): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new Error("weightedPick called with zero total weight");
  let r = rng.next() * total;
  for (const entry of entries) {
    r -= entry.weight;
    if (r < 0) return entry;
  }
  return entries[entries.length - 1];
}

export function rollRarity(rng: Rng, weights: RarityWeights): Rarity {
  const entries: Array<{ key: Rarity; weight: number }> = [
    { key: "common", weight: weights.common },
    { key: "magic", weight: weights.magic },
    { key: "rare", weight: weights.rare },
    { key: "unique", weight: weights.unique },
  ];
  return weightedPick(rng, entries).key;
}

function generateItem(
  rng: Rng,
  ref: WeightedItemRef,
  rarityWeights: RarityWeights,
  instanceId: string,
): ItemInstance {
  const base = findItemBase(ref.baseId);
  if (!base) throw new Error(`unknown item base "${ref.baseId}"`);
  const rarity = ref.rarity ?? rollRarity(rng, rarityWeights);
  const { prefixes, suffixes } = rollAffixes(rng, base.ilvl, rarity);
  const implicit = ref.implicitAffixId
    ? rollImplicitAffix(rng, ref.implicitAffixId)
    : null;
  return {
    instanceId,
    baseId: base.id,
    rarity,
    ilvl: base.ilvl,
    prefixes,
    suffixes,
    implicit,
  };
}

export function rollLootTable(
  rng: Rng,
  table: LootTable,
  startId: number,
): LootRollResult {
  if (rng.next() >= table.dropChance) return { items: [], nextId: startId };
  const ref = weightedPick(rng, table.items);
  const item = generateItem(rng, ref, table.rarityWeights, `itm-${startId}`);
  return { items: [item], nextId: startId + 1 };
}

export function rollImplicitPool(
  rng: Rng,
  pool: MonsterImplicitPool,
  startId: number,
): LootRollResult {
  if (rng.next() >= pool.dropChance) return { items: [], nextId: startId };
  const ref = weightedPick(rng, pool.items);
  const weights = pool.rarityWeights ?? DEFAULT_RARITY_WEIGHTS;
  const item = generateItem(rng, ref, weights, `itm-${startId}`);
  return { items: [item], nextId: startId + 1 };
}

export function rollEnemyLoot(
  rng: Rng,
  defId: string,
  startId: number,
  lootTableRef?: string,
): LootRollResult {
  const monster = findMonster(defId);
  if (!monster) return { items: [], nextId: startId };
  let items: ItemInstance[] = [];
  let nextId = startId;
  const table = findLootTable(lootTableRef ?? monster.lootTableRef);
  if (table) {
    const result = rollLootTable(rng, table, nextId);
    items = [...items, ...result.items];
    nextId = result.nextId;
  }
  if (monster.implicitPoolRef) {
    const pool = findImplicitPool(monster.implicitPoolRef);
    if (pool) {
      const result = rollImplicitPool(rng, pool, nextId);
      items = [...items, ...result.items];
      nextId = result.nextId;
    }
  }
  return { items, nextId };
}

export function rollVictoryLoot(
  rng: Rng,
  enemies: readonly LootEnemy[],
  startId: number,
  dungeon?: DungeonLootContext,
): LootRollResult {
  const lootTableRef = dungeonLootTableRef(dungeon);
  let items: ItemInstance[] = [];
  let nextId = startId;
  for (const enemy of enemies) {
    if (enemy.hp > 0) continue;
    const result = rollEnemyLoot(rng, enemy.defId, nextId, lootTableRef);
    items = [...items, ...result.items];
    nextId = result.nextId;
  }
  return { items, nextId };
}

export function rollChestLoot(
  rng: Rng,
  floor: number,
  startId: number,
  dungeonId?: string,
): LootRollResult {
  const lootTableRef = dungeonId
    ? dungeonLootTableRef({ dungeonId, floor })
    : undefined;
  const table = lootTableRef
    ? chestLootTableForRef(lootTableRef)
    : chestLootTableFor(floor);
  return rollLootTable(rng, table, startId);
}
