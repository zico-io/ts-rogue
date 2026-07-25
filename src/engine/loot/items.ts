/**
 * Item helpers (PROJECT_PLAN Phase 5, ROG-11). Pure, UI-free queries over a
 * generated `ItemInstance`: the total stat block it grants when equipped, its
 * sell price, its equipment slot, and display strings shared by the message log
 * and the store UI. The engine and UI both call these so loot log lines and the
 * store compare panel never disagree.
 */

import { findAffix } from "../../data/affixes";
import { findItemBase } from "../../data/itemBases";
import type {
  ItemInstance,
  ItemSlot,
  ItemStats,
  Rarity,
  RolledAffix,
} from "./types";

/** Display label per rarity (used in log lines and the store panel). */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  magic: "Magic",
  rare: "Rare",
  unique: "Unique",
};

/** Sell-value multiplier per rarity, applied to the base's `baseValue`. */
export const RARITY_SELL_MULTIPLIER: Record<Rarity, number> = {
  common: 1,
  magic: 2,
  rare: 3,
  unique: 5,
};

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

/** Total stat block an item grants: base stats plus every rolled and implicit affix. */
export function itemStats(item: ItemInstance): ItemStats {
  const base = findItemBase(item.baseId);
  const stats: ItemStats = { str: 0, agi: 0, vit: 0, int: 0 };
  if (base) {
    for (const key of STAT_KEYS) stats[key] += base.stats[key] ?? 0;
  }
  for (const affix of [item.implicit, ...item.prefixes, ...item.suffixes]) {
    if (!affix) continue;
    const def = findAffix(affix.affixId);
    if (!def) continue;
    stats[def.stat] += affix.value;
  }
  return stats;
}

/** Sum of all rolled and implicit affix values (drives the sell-price bonus). */
export function itemAffixValueSum(item: ItemInstance): number {
  let sum = 0;
  for (const affix of [item.implicit, ...item.prefixes, ...item.suffixes]) {
    if (affix) sum += affix.value;
  }
  return sum;
}

/** Sell price in gold: base value times the rarity multiplier plus affix value. */
export function itemSellPrice(item: ItemInstance): number {
  const base = findItemBase(item.baseId);
  const baseValue = base?.baseValue ?? 0;
  return (
    Math.floor(baseValue * RARITY_SELL_MULTIPLIER[item.rarity]) +
    itemAffixValueSum(item)
  );
}

/** Equipment slot an item occupies, derived from its base. */
export function itemBaseSlot(item: ItemInstance): ItemSlot | undefined {
  return findItemBase(item.baseId)?.slot;
}

/**
 * Display name: rarity label plus the base name, with the first rolled prefix
 * prepended and the first rolled suffix appended (Diablo-style). The implicit
 * is shown separately in {@link itemStatLine} so the base name stays readable.
 */
export function describeItem(item: ItemInstance): string {
  const base = findItemBase(item.baseId);
  let name = base?.name ?? item.baseId;
  const firstPrefix = item.prefixes[0];
  if (firstPrefix) {
    const def = findAffix(firstPrefix.affixId);
    if (def) name = `${def.name} ${name}`;
  }
  const firstSuffix = item.suffixes[0];
  if (firstSuffix) {
    const def = findAffix(firstSuffix.affixId);
    if (def) name = `${name} ${def.name}`;
  }
  return `${RARITY_LABEL[item.rarity]} ${name}`;
}

/** Compact stat summary for the store compare panel, including the implicit. */
export function itemStatLine(item: ItemInstance): string {
  const stats = itemStats(item);
  const parts: string[] = [];
  for (const key of STAT_KEYS) {
    if (stats[key] !== 0) {
      parts.push(
        `${stats[key] >= 0 ? "+" : ""}${stats[key]} ${key.toUpperCase()}`,
      );
    }
  }
  let line = parts.join(" ");
  if (item.implicit) {
    const def = findAffix(item.implicit.affixId);
    if (def) {
      line += ` (implicit: ${def.name} +${item.implicit.value} ${def.stat.toUpperCase()})`;
    }
  }
  return line;
}

/** One inspect line for a single rolled/implicit affix, e.g. "Prefix: Vicious +5 STR". */
function affixLine(label: string, affix: RolledAffix): string | undefined {
  const def = findAffix(affix.affixId);
  if (!def) return undefined;
  return `${label}: ${def.name} +${affix.value} ${def.stat.toUpperCase()}`;
}

/**
 * Full affix breakdown for the inventory inspect view (ENG-3): one line per
 * implicit/prefix/suffix, in that order, naming the affix and its rolled
 * value - unlike {@link itemStatLine}'s compact summed-stat line, every roll
 * gets its own line here.
 */
export function itemAffixLines(item: ItemInstance): string[] {
  const lines: string[] = [];
  if (item.implicit) {
    const line = affixLine("Implicit", item.implicit);
    if (line) lines.push(line);
  }
  for (const prefix of item.prefixes) {
    const line = affixLine("Prefix", prefix);
    if (line) lines.push(line);
  }
  for (const suffix of item.suffixes) {
    const line = affixLine("Suffix", suffix);
    if (line) lines.push(line);
  }
  return lines;
}
