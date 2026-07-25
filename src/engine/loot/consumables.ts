/**
 * Shared consumable-item logic (ENG-4). Hoisted out of `combat/resolution.ts`
 * - where it was battle-only - so field consumable use (the inventory
 * screen's consumables section, usable in the village/overworld/dungeon)
 * and battle's `item` command share one heal table and one
 * decrement-a-stack helper instead of two copies drifting apart. Battle's
 * item flow is unchanged: it still only allows heal items and still targets
 * the acting party member.
 */

import type { InventoryItem } from "../entities/party";

/** Consumable items that restore HP, and how much. */
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

/** Decrements one unit of `itemId` from `inventory`, dropping the stack at zero. */
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
