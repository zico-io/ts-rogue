/**
 * Loot filter (ENG-2). Auto-dismantles unwanted field drops so a long dungeon
 * run doesn't require manually sifting the backpack. Disabled by default -
 * `DEFAULT_LOOT_FILTER` never dismantles anything until the player opts in
 * from the Inventory screen's filter pane.
 *
 * `shouldDismantle` is a safety net, not a strict filter: an item is only
 * dismantled when it fails every one of the enabled checks. Any single
 * passing condition (rarity, ilvl-relative-to-party, or a kept affix stat)
 * keeps it, so a filter tuned to skip common trash can never accidentally
 * eat something the player flagged as always-keep.
 *
 * No `classAffinity` or crafting-currency concept exists in this codebase
 * yet (ROG-25/ROG-36 have not landed); this filter has no rule for either -
 * add one alongside those systems' item shapes, not before.
 */

import { findAffix } from "../../data/affixes";
import type { ItemInstance, ItemStat, Rarity } from "./types";

const RARITY_ORDER: readonly Rarity[] = ["common", "magic", "rare", "unique"];

export interface LootFilterSettings {
  enabled: boolean;
  /** Dismantle candidates below this rarity tier (inclusive floor to keep). */
  minRarity: Rarity;
  /** Keep if `item.ilvl + minIlvlOffset >= partyLevel`; very negative = always passes. */
  minIlvlOffset: number;
  /** Always keep an item carrying an affix on any of these stats. */
  keepAffixStats: ItemStat[];
}

/** Disabled by default; the player opts in from the Inventory screen's filter pane. */
export const DEFAULT_LOOT_FILTER: LootFilterSettings = {
  enabled: false,
  minRarity: "common",
  minIlvlOffset: -999,
  keepAffixStats: [],
};

function rarityIndex(rarity: Rarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

/** Whether `item` carries a rolled or implicit affix on one of `stats`. */
function itemHasAffixStat(
  item: ItemInstance,
  stats: readonly ItemStat[],
): boolean {
  if (stats.length === 0) return false;
  for (const affix of [item.implicit, ...item.prefixes, ...item.suffixes]) {
    if (!affix) continue;
    const def = findAffix(affix.affixId);
    if (def && stats.includes(def.stat)) return true;
  }
  return false;
}

/**
 * Whether `item` should be auto-dismantled under `filter` for a party at
 * `partyLevel`. Always false when the filter is disabled. Otherwise
 * dismantles only if the item fails the rarity bar AND the ilvl bar AND
 * carries none of the keep-listed affix stats.
 */
export function shouldDismantle(
  item: ItemInstance,
  filter: LootFilterSettings,
  partyLevel: number,
): boolean {
  if (!filter.enabled) return false;
  const belowRarity = rarityIndex(item.rarity) < rarityIndex(filter.minRarity);
  const belowIlvl = item.ilvl + filter.minIlvlOffset < partyLevel;
  const keepsAffix = itemHasAffixStat(item, filter.keepAffixStats);
  return belowRarity && belowIlvl && !keepsAffix;
}
