/**
 * Loot filter rules (ENG-17). A player-editable, engine-only rule set that
 * decides whether a given generated item should be auto-dismantled at pickup
 * time. No UI yet (the settings pane is ENG-19); this is just the data shape,
 * the pure check function, and the event/reducer wiring.
 *
 * Deferred until ROG-25 lands: classAffinity matching.
 */

import { findAffix } from "../../data/affixes";
import {
  type ItemInstance,
  type ItemStat,
  RARITY_ORDER,
  type Rarity,
} from "./types";

export interface LootFilterRules {
  /**
   * Minimum rarity to auto-keep, keyed by dungeon tier
   * (see data/lootTables.ts's tier-1/2/3 convention: 1 = shallow,
   * 3+ = deep/boss). Absent tier = no rarity floor for that tier.
   */
  minRarityByTier: Partial<Record<number, Rarity>>;
  /**
   * Item is kept on this condition when ilvl >= partyLevel + this offset.
   * undefined = condition not configured (never contributes to keeping OR
   * dismantling). Can be negative to tolerate under-leveled ilvl.
   */
  minIlvlOffset?: number;
  /**
   * Item is kept if it carries any affix (implicit/prefix/suffix) whose
   * ItemStat is in this list. Empty/absent = not configured.
   */
  keepAffixStats: ItemStat[];
  // Class-affinity match (ROG-25's classAffinity) is deferred until ROG-25
  // lands - do NOT implement it, just leave this comment as a marker for
  // where it slots in later (see engine/loot/inventory.ts comments
  // referencing ENG-5/ROG-25 for the style of these deferral markers).
}

export const EMPTY_LOOT_FILTER: LootFilterRules = {
  minRarityByTier: {},
  keepAffixStats: [],
};

export interface LootFilterContext {
  dungeonTier: number;
  partyLevel: number;
}

/**
 * Map a dungeon floor number to the tier used by loot tables and filter rules.
 * Matches the same cutoffs as `chestLootTableFor` in data/lootTables.ts:
 * floor <= 1 -> 1, floor === 2 -> 2, else -> 3.
 */
export function dungeonTierForFloor(floor: number): number {
  if (floor <= 1) return 1;
  if (floor === 2) return 2;
  return 3;
}

/**
 * Decide whether `item` should be dismantled given the active filter rules
 * and context.
 *
 * Safety-net: dismantle only when EVERY configured condition fails. If zero
 * conditions are configured, never dismantle.
 *
 * Configured conditions:
 * 1. Rarity-floor: configured iff `rules.minRarityByTier[context.dungeonTier]`
 *    is set. Passes if item.rarity >= the floor.
 * 2. Ilvl-floor: configured iff `rules.minIlvlOffset !== undefined`. Passes
 *    if item.ilvl >= context.partyLevel + rules.minIlvlOffset.
 * 3. Affix-keep: configured iff `rules.keepAffixStats.length > 0`. Passes if
 *    any affix on the item (implicit, prefixes, suffixes) resolves via
 *    `findAffix` to an `AffixDef` whose `.stat` is in keepAffixStats.
 */
export function shouldDismantle(
  item: ItemInstance,
  rules: LootFilterRules,
  context: LootFilterContext,
): boolean {
  const results: boolean[] = [];

  // 1. Rarity-floor condition
  const minRarity = rules.minRarityByTier[context.dungeonTier];
  if (minRarity !== undefined) {
    results.push(RARITY_ORDER[item.rarity] >= RARITY_ORDER[minRarity]);
  }

  // 2. Ilvl-floor condition
  if (rules.minIlvlOffset !== undefined) {
    results.push(item.ilvl >= context.partyLevel + rules.minIlvlOffset);
  }

  // 3. Affix-keep condition
  if (rules.keepAffixStats.length > 0) {
    const affixIds = [
      ...(item.implicit ? [item.implicit.affixId] : []),
      ...item.prefixes.map((a) => a.affixId),
      ...item.suffixes.map((a) => a.affixId),
    ];
    const passes = affixIds.some((affixId) => {
      const def = findAffix(affixId);
      return def !== undefined && rules.keepAffixStats.includes(def.stat);
    });
    results.push(passes);
  }

  // No configured conditions: filter inactive, never dismantle.
  if (results.length === 0) return false;

  // Dismantle iff every configured condition failed.
  return results.every((passed) => !passed);
}
