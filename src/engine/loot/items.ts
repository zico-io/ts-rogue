import { findAffix } from "../../data/affixes";
import { findItemBase } from "../../data/itemBases";
import type {
  ItemInstance,
  ItemSlot,
  ItemStats,
  Rarity,
  RolledAffix,
} from "./types";

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  magic: "Magic",
  rare: "Rare",
  unique: "Unique",
};

export const RARITY_SELL_MULTIPLIER: Record<Rarity, number> = {
  common: 1,
  magic: 2,
  rare: 3,
  unique: 5,
};

const STAT_KEYS = ["str", "agi", "vit", "int"] as const;

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

export function itemAffixValueSum(item: ItemInstance): number {
  let sum = 0;
  for (const affix of [item.implicit, ...item.prefixes, ...item.suffixes]) {
    if (affix) sum += affix.value;
  }
  return sum;
}

export function itemSellPrice(item: ItemInstance): number {
  const base = findItemBase(item.baseId);
  const baseValue = base?.baseValue ?? 0;
  return (
    Math.floor(baseValue * RARITY_SELL_MULTIPLIER[item.rarity]) +
    itemAffixValueSum(item)
  );
}

// Shop buy price for a rolled item (ENG-41): a straight markup on the same
// itemSellPrice a player would get selling it back, so raising or lowering
// the sell-side formula (baseValue + rarity multiplier + affix value sum)
// automatically keeps the buy side honest instead of drifting via a second,
// parallel price formula.
const SHOP_BUY_MARKUP = 2;

export function rolledItemPrice(item: ItemInstance): number {
  return itemSellPrice(item) * SHOP_BUY_MARKUP;
}

export function itemBaseSlot(item: ItemInstance): ItemSlot | undefined {
  return findItemBase(item.baseId)?.slot;
}

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

function affixLine(label: string, affix: RolledAffix): string | undefined {
  const def = findAffix(affix.affixId);
  if (!def) return undefined;
  return `${label}: ${def.name} +${affix.value} ${def.stat.toUpperCase()}`;
}

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
