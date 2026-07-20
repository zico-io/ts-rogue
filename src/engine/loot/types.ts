/**
 * Loot system types (PROJECT_PLAN Phase 5, ROG-11).
 *
 * Pure, UI-free data shapes for the affix-driven loot system. These types are
 * shared by the static content in `src/data` (item bases, affixes, loot tables,
 * implicit pools) and the engine resolution/equipment helpers in
 * `src/engine/loot`. Nothing here imports from `src/ui` or from the combat or
 * state modules, so there is no import cycle: `state/types` imports these types
 * for `ItemInstance`, and the loot helpers import data that re-imports these.
 */

/** The four core stats an item or affix can modify. Matches `CoreStats`. */
export type ItemStat = "str" | "agi" | "vit" | "int";

/** A full stat block keyed by stat. Structurally compatible with `CoreStats`. */
export type ItemStats = Record<ItemStat, number>;

/** Equipment slot an item base occupies on a party member. */
export type ItemSlot = "weapon" | "armor" | "accessory";

/** The four equipment slots on a party member (keys of `PartyMemberEquipment`). */
export type EquipmentSlotName =
  | "weapon"
  | "armor"
  | "accessory1"
  | "accessory2";

/**
 * Rarity tiers (PROJECT_PLAN Phase 5, section 6). Higher rarities roll more
 * affixes and sell for more. Unique is reserved for signature drops from
 * monster-implicit pools and very rare generic rolls.
 */
export type Rarity = "common" | "magic" | "rare" | "unique";

/** Weighted rarity roll inputs; each table/pool carries its own tuning. */
export interface RarityWeights {
  common: number;
  magic: number;
  rare: number;
  unique: number;
}

/**
 * A static item base (PROJECT_PLAN Phase 5, section 7). The base fixes the
 * slot, an item level that gates which affixes can roll onto it, flat base
 * stats granted when equipped, and a base sell value before rarity/affix
 * adjustments. Higher ilvl bases live in deeper loot tables so affix gating
 * supports endless powerscaling later.
 */
export interface ItemBaseDef {
  id: string;
  name: string;
  slot: ItemSlot;
  ilvl: number;
  stats: Partial<ItemStats>;
  /** Base sell value (gold) before rarity and affix adjustments. */
  baseValue: number;
}

/** Prefix vs suffix affix, Diablo-style. */
export type AffixKind = "prefix" | "suffix";

/**
 * A static affix definition (PROJECT_PLAN Phase 5, section 7). A rolled affix
 * picks a value in `[min, max]`. `ilvl` gates rolling: an affix only rolls onto
 * an item whose ilvl is `>=` the affix's ilvl, so deeper content unlocks
 * stronger affixes. `weight` drives weighted selection within a kind.
 */
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

/** An affix instance rolled onto an item: the affix id plus its rolled value. */
export interface RolledAffix {
  affixId: string;
  value: number;
}

/**
 * A generated, affix-bearing item instance (PROJECT_PLAN Phase 5, section 6).
 * Plain serializable data so it lives in the `GameState` tree and round-trips
 * through save/load. `instanceId` is unique within a run (assigned from
 * `GameState.nextItemId`); equipment slots hold the full instance so a save is
 * self-contained. `implicit` is the fixed signature affix carried on top of the
 * rolled prefixes/suffixes - the hook that makes a monster-implicit drop
 * recognizably that monster's.
 */
export interface ItemInstance {
  instanceId: string;
  baseId: string;
  rarity: Rarity;
  ilvl: number;
  prefixes: RolledAffix[];
  suffixes: RolledAffix[];
  implicit: RolledAffix | null;
}

/**
 * A weighted reference to an item base inside a loot table or implicit pool.
 * `rarity` forces a rarity (used by signature items); `implicitAffixId` attaches
 * a fixed signature affix on top of the rolled affixes.
 */
export interface WeightedItemRef {
  baseId: string;
  weight: number;
  rarity?: Rarity;
  implicitAffixId?: string;
}

/**
 * A weighted loot table (PROJECT_PLAN Phase 5, section 7). `dropChance` is the
 * base-tier roll (does anything drop?); on a drop, a rarity is rolled from
 * `rarityWeights` and a base is picked from `items`. Per-tier trash tables, the
 * boss table, and chest tables are all instances of this shape.
 */
export interface LootTable {
  id: string;
  dropChance: number;
  rarityWeights: RarityWeights;
  items: readonly WeightedItemRef[];
}

/**
 * A monster-implicit pool (PROJECT_PLAN Phase 5, section 7). `sourceId` is
 * either a unique boss id (`boss_...`, single source) or an enemy type id
 * (`type_...`, drops from any of that type across the world) - mirroring the
 * Grim Dawn distinction. `dropChance` is intentionally infrequent for type
 * pools and reliable for boss pools so a boss kill yields its dedicated drop.
 */
export interface MonsterImplicitPool {
  sourceId: string;
  dropChance: number;
  rarityWeights?: RarityWeights;
  items: readonly WeightedItemRef[];
}

/** Result of a seeded loot roll: the generated items and the next instance id. */
export interface LootRollResult {
  items: ItemInstance[];
  nextId: number;
}
