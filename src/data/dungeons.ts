import { findShopItem } from "./shops";

export interface ChestLoot {
  gold: number;
  itemId: string | null;
  quantity: number;
}

export function chestLootFor(
  dungeonId: string,
  floor: number,
  x: number,
  y: number,
): ChestLoot {
  const dungeonHash = dungeonId.charCodeAt(0) + dungeonId.length;
  const gold = 20 + ((x * 7 + y * 13 + floor * 5 + dungeonHash) % 40);
  return { gold, itemId: "potion", quantity: 1 };
}

export function chestLootMessage(loot: ChestLoot): string {
  const item = loot.itemId ? findShopItem(loot.itemId) : undefined;
  const itemPart = item ? ` and ${loot.quantity} ${item.name}` : "";
  return `You open the chest and find ${loot.gold} gold${itemPart}!`;
}
