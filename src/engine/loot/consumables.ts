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
