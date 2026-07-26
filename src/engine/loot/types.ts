export type ItemStat = "str" | "agi" | "vit" | "int";

export type ItemStats = Record<ItemStat, number>;

export type ItemSlot = "weapon" | "armor" | "accessory";

export type EquipmentSlotName =
  | "weapon"
  | "armor"
  | "accessory1"
  | "accessory2";

export type Rarity = "common" | "magic" | "rare" | "unique";

export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  magic: 1,
  rare: 2,
  unique: 3,
};

export interface RarityWeights {
  common: number;
  magic: number;
  rare: number;
  unique: number;
}

export interface ItemBaseDef {
  id: string;
  name: string;
  slot: ItemSlot;
  ilvl: number;
  stats: Partial<ItemStats>;

  baseValue: number;
}

export type AffixKind = "prefix" | "suffix";

export interface AffixDef {
  id: string;
  kind: AffixKind;
  name: string;
  stat: ItemStat;
  min: number;
  max: number;
  ilvl: number;
  weight: number;
}

export interface RolledAffix {
  affixId: string;
  value: number;
}

export interface ItemInstance {
  instanceId: string;
  baseId: string;
  rarity: Rarity;
  ilvl: number;
  prefixes: RolledAffix[];
  suffixes: RolledAffix[];
  implicit: RolledAffix | null;
}

export interface WeightedItemRef {
  baseId: string;
  weight: number;
  rarity?: Rarity;
  implicitAffixId?: string;
}

export interface LootTable {
  id: string;
  dropChance: number;
  rarityWeights: RarityWeights;
  items: readonly WeightedItemRef[];
}

export interface MonsterImplicitPool {
  sourceId: string;
  dropChance: number;
  rarityWeights?: RarityWeights;
  items: readonly WeightedItemRef[];
}

export interface LootRollResult {
  items: ItemInstance[];
  nextId: number;
}
