import { findItemBase } from "./itemBases";

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  minLevel: number;
}

// Gear rows reuse an ItemBaseDef id directly (rather than a separate shop-only
// id) so a purchase mints a real common-rarity ItemInstance for that base -
// see storeBuy in engine/state/store.ts. Their price is fixed at 2x baseValue
// so sellPriceFor(item) here (price * SELL_PRICE_RATIO) equals the item's real
// itemSellPrice once bought (common rarity, no affixes): one invariant keeps
// the displayed buy/sell pair honest without a second value formula.
export const SHOP_ITEMS: readonly ShopItem[] = [
  // Tier 1 - starter goods, available from level 1.
  { id: "potion", name: "Potion", price: 10, minLevel: 1 },
  { id: "antidote", name: "Antidote", price: 8, minLevel: 1 },
  { id: "thermal-salts", name: "Thermal Salts", price: 12, minLevel: 1 },
  { id: "rusty-dagger", name: "Rusty Dagger", price: 10, minLevel: 1 },
  { id: "tunic", name: "Tunic", price: 10, minLevel: 1 },
  { id: "copper-ring", name: "Copper Ring", price: 10, minLevel: 1 },

  // Tier 2 - mid-game, unlocks at level 5.
  { id: "hi-potion", name: "Hi-Potion", price: 50, minLevel: 5 },
  { id: "iron-sword", name: "Iron Sword", price: 24, minLevel: 5 },
  { id: "leather-vest", name: "Leather Vest", price: 24, minLevel: 5 },
  { id: "silver-pendant", name: "Silver Pendant", price: 30, minLevel: 5 },

  // Tier 3 - late-game, unlocks at level 10.
  { id: "war-blade", name: "War Blade", price: 50, minLevel: 10 },
  { id: "plate-mail", name: "Plate Mail", price: 50, minLevel: 10 },
];

export function findShopItem(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}

/** Gear rows mint an ItemInstance on purchase; everything else is a stackable consumable. */
export function isGearShopItem(itemId: string): boolean {
  return findItemBase(itemId) !== undefined;
}

export function unlockedShopItems(level: number): readonly ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.minLevel <= level);
}

/** Lowest minLevel still above `level`, for an optional locked-tier teaser. */
export function nextLockedTier(level: number): number | undefined {
  const locked = SHOP_ITEMS.map((item) => item.minLevel).filter(
    (minLevel) => minLevel > level,
  );
  return locked.length === 0 ? undefined : Math.min(...locked);
}

export const SELL_PRICE_RATIO = 0.5;

export function sellPriceFor(item: ShopItem): number {
  return Math.floor(item.price * SELL_PRICE_RATIO);
}
