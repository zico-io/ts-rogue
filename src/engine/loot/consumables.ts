import type { StatusEffectId } from "../combat/statusEffects";
import { findStatusEffect } from "../combat/statusEffects";
import type { InventoryItem } from "../entities/party";

export const HEAL_ITEMS: Readonly<Record<string, number>> = {
  potion: 30,
  "hi-potion": 99,
};

export function isHealItem(itemId: string): boolean {
  return itemId in HEAL_ITEMS;
}

export function healAmount(itemId: string): number {
  return HEAL_ITEMS[itemId] ?? 0;
}

// Cure items remove specific status effect instances rather than healing HP.
// Antidote cures poison; Thermal Salts cure the temperature-extreme duo
// (burn/chilled) in one use rather than shipping two single-purpose items.
export const CURE_ITEMS: Readonly<Record<string, readonly StatusEffectId[]>> = {
  antidote: ["poison"],
  "thermal-salts": ["burn", "chilled"],
};

export function isCureItem(itemId: string): boolean {
  return itemId in CURE_ITEMS;
}

export function curedEffects(itemId: string): readonly StatusEffectId[] {
  return CURE_ITEMS[itemId] ?? [];
}

export function isUsableBattleItem(itemId: string): boolean {
  return isHealItem(itemId) || isCureItem(itemId);
}

// Shared label for the battle Item menu: heal items show the HP restored,
// cure items list the status(es) they remove.
export function battleItemEffectLabel(itemId: string): string {
  const heal = healAmount(itemId);
  if (heal > 0) return `heal ${heal}`;
  const cures = curedEffects(itemId);
  if (cures.length > 0) {
    const names = cures
      .map((effectId) => findStatusEffect(effectId)?.name ?? effectId)
      .join(" & ");
    return `cures ${names}`;
  }
  return "";
}

export function consumeItem(
  inventory: readonly InventoryItem[],
  itemId: string,
): InventoryItem[] {
  const owned = inventory.find((entry) => entry.itemId === itemId);
  if (!owned) return [...inventory];
  const remaining = owned.quantity - 1;
  return remaining > 0
    ? inventory.map((entry) =>
        entry.itemId === itemId ? { ...entry, quantity: remaining } : entry,
      )
    : inventory.filter((entry) => entry.itemId !== itemId);
}
