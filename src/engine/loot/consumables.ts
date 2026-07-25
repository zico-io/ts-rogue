/**
 * Consumable-item helpers (ENG-2). Hoisted out of `combat/resolution.ts` so
 * field item use (outside battle) and battle item use share the exact same
 * heal table and stack-decrement logic instead of two copies drifting apart.
 * Pure, no battle/UI coupling - this module only touches `InventoryItem[]`.
 */

import type { InventoryItem } from "../entities/party";

/** Healing items and how much HP they restore, usable in battle or in the field. */
export const BATTLE_ITEM_HEAL: Readonly<Record<string, number>> = {
  potion: 30,
  "hi-potion": 99,
};

/** Whether `itemId` is a recognized heal item (battle or field use). */
export function isHealItem(itemId: string): boolean {
  return itemId in BATTLE_ITEM_HEAL;
}

/** HP restored by `itemId`, or 0 if it is not a heal item. */
export function healAmount(itemId: string): number {
  return BATTLE_ITEM_HEAL[itemId] ?? 0;
}

/**
 * Decrement one unit of `itemId` from a consumable stack, removing the stack
 * entirely once it reaches zero. A no-op (returns a shallow copy) when the
 * item isn't owned, so callers can call this unconditionally after validating
 * ownership themselves.
 */
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
