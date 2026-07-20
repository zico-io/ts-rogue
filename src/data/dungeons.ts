/**
 * Static dungeon content (PROJECT_PLAN Phase 3, ROG-9).
 *
 * Chest loot lives here as deterministic data so the engine stays free of
 * hardcoded content. Chest loot is a pure function of the chest's floor +
 * position so it never consumes engine RNG and a save/reload always agrees.
 * Monster definitions (stats, ASCII art, XP/gold) moved to `./monsters.ts`
 * in Phase 4 (ROG-10), where the combat resolver reads them.
 */

import { findShopItem } from "./shops";

/** What a chest yields when opened. `itemId: null` means gold only. */
export interface ChestLoot {
  gold: number;
  itemId: string | null;
  quantity: number;
}

/**
 * Stub loot table: 20-59 gold plus one Potion, deterministic from the chest's
 * floor and grid position. Phase 4+ can vary this per dungeon / floor.
 */
export function chestLootFor(
  dungeonId: string,
  floor: number,
  x: number,
  y: number,
): ChestLoot {
  // Fold every input into the gold roll so the loot is deterministic from the
  // chest's identity (dungeon + floor + position) without consuming RNG.
  const dungeonHash = dungeonId.charCodeAt(0) + dungeonId.length;
  const gold = 20 + ((x * 7 + y * 13 + floor * 5 + dungeonHash) % 40);
  return { gold, itemId: "potion", quantity: 1 };
}

/** Human-readable summary of a chest's contents, for the message log. */
export function chestLootMessage(loot: ChestLoot): string {
  const item = loot.itemId ? findShopItem(loot.itemId) : undefined;
  const itemPart = item ? ` and ${loot.quantity} ${item.name}` : "";
  return `You open the chest and find ${loot.gold} gold${itemPart}!`;
}
