/**
 * Loot resolution (PROJECT_PLAN Phase 5, ROG-11). The seeded drop pipeline from
 * section 6, pure and deterministic: every roll routes through the seeded `Rng`
 * so a kill or chest is reproducible from the seed plus the event history, and
 * the consumed state is persisted back onto `GameState.rngState` by the caller.
 *
 * Drop resolution order (per kill / per chest):
 *   1. Base tier roll - does anything drop? (`LootTable.dropChance`)
 *   2. Rarity roll - common / magic / rare / unique (weighted per table/pool).
 *   3. Source pool select - trash mobs roll their tier loot table; bosses and
 *      special enemy types ALSO roll their monster-implicit pool.
 *   4. Affix generation - prefix/suffix affixes appropriate to rarity and the
 *      item base's ilvl; signature items add a fixed implicit on top.
 *
 * Each roll returns the generated `ItemInstance`s plus the next instance id, so
 * the store can stamp unique ids from `GameState.nextItemId` deterministically.
 */

import { findImplicitPool } from "../../data/implicitPools";
import { findItemBase } from "../../data/itemBases";
import { chestLootTableFor, findLootTable } from "../../data/lootTables";
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

/** Default rarity weights when a pool does not override them. */
export const DEFAULT_RARITY_WEIGHTS: RarityWeights = {
  common: 60,
  magic: 30,
  rare: 9,
  unique: 1,
};

/** A defeated enemy, as the loot pipeline needs it (a structural slice of `BattleEnemy`). */
export interface LootEnemy {
  defId: string;
  hp: number;
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

/** Roll a rarity from weighted tiers. Consumes one `Rng.next()` roll. */
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

/** Roll a single loot table: base-tier roll, then rarity, base, and affixes. */
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

/** Roll a monster-implicit pool: dropChance, then a weighted signature item. */
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

/**
 * Roll all loot for one defeated enemy: its tier loot table, then (if it has an
 * implicit pool ref) its monster-implicit pool. Ids are stamped sequentially
 * from `startId`.
 */
export function rollEnemyLoot(
  rng: Rng,
  defId: string,
  startId: number,
): LootRollResult {
  const monster = findMonster(defId);
  if (!monster) return { items: [], nextId: startId };
  let items: ItemInstance[] = [];
  let nextId = startId;
  const table = findLootTable(monster.lootTableRef);
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

/**
 * Roll victory loot for a defeated enemy group. Only enemies with `hp <= 0`
 * drop. Used by the combat victory hook; `enemies` is a structural slice of
 * `BattleEnemy[]` so this module stays decoupled from combat types.
 */
export function rollVictoryLoot(
  rng: Rng,
  enemies: readonly LootEnemy[],
  startId: number,
): LootRollResult {
  let items: ItemInstance[] = [];
  let nextId = startId;
  for (const enemy of enemies) {
    if (enemy.hp > 0) continue;
    const result = rollEnemyLoot(rng, enemy.defId, nextId);
    items = [...items, ...result.items];
    nextId = result.nextId;
  }
  return { items, nextId };
}

/** Roll a chest's generated-item drop for the given floor (chests always roll). */
export function rollChestLoot(
  rng: Rng,
  floor: number,
  startId: number,
): LootRollResult {
  return rollLootTable(rng, chestLootTableFor(floor), startId);
}
