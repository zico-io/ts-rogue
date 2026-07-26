export interface ShopItem {
  id: string;
  name: string;
  price: number;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "potion", name: "Potion", price: 10 },
  { id: "hi-potion", name: "Hi-Potion", price: 50 },
  { id: "antidote", name: "Antidote", price: 8 },
  { id: "thermal-salts", name: "Thermal Salts", price: 12 },
  { id: "leather-armor", name: "Leather Armor", price: 40 },
  { id: "short-sword", name: "Short Sword", price: 60 },
];

export function findShopItem(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}

export const SELL_PRICE_RATIO = 0.5;

export function sellPriceFor(item: ShopItem): number {
  return Math.floor(item.price * SELL_PRICE_RATIO);
}
