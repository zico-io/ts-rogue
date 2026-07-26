import { findAffix } from "../../data/affixes";
import {
  type ItemInstance,
  type ItemStat,
  RARITY_ORDER,
  type Rarity,
} from "./types";

export interface LootFilterRules {
  minRarityByTier: Partial<Record<number, Rarity>>;

  minIlvlOffset?: number;

  keepAffixStats: ItemStat[];
}

export const EMPTY_LOOT_FILTER: LootFilterRules = {
  minRarityByTier: {},
  keepAffixStats: [],
};

export interface LootFilterContext {
  dungeonTier: number;
  partyLevel: number;
}

export function shouldDismantle(
  item: ItemInstance,
  rules: LootFilterRules,
  context: LootFilterContext,
): boolean {
  const results: boolean[] = [];

  const minRarity = rules.minRarityByTier[context.dungeonTier];
  if (minRarity !== undefined) {
    results.push(RARITY_ORDER[item.rarity] >= RARITY_ORDER[minRarity]);
  }

  if (rules.minIlvlOffset !== undefined) {
    results.push(item.ilvl >= context.partyLevel + rules.minIlvlOffset);
  }

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

  if (results.length === 0) return false;

  return results.every((passed) => !passed);
}
