/**
 * Party & economy data model (PROJECT_PLAN §4.2, §10).
 *
 * PROJECT_PLAN §10 defers multi-member parties until the loop is proven, so
 * `newGame` only ever creates one hero. `party` is still modeled as an array
 * so battle/UI code written against it does not need to change shape later.
 */

/** Nullable reference to an owned item by id, occupying an equipment slot. */
export type EquipmentSlot = string | null;

export interface PartyMemberEquipment {
  weapon: EquipmentSlot;
  armor: EquipmentSlot;
  accessory1: EquipmentSlot;
  accessory2: EquipmentSlot;
}

export interface PartyMemberStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
}

export interface PartyMember {
  id: string;
  name: string;
  level: number;
  xp: number;
  stats: PartyMemberStats;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  equipment: PartyMemberEquipment;
}

/** An owned, unequipped stack of items (equipped items live on `PartyMember.equipment`). */
export interface InventoryItem {
  itemId: string;
  quantity: number;
}

/** Deterministic starting hero for a fresh run. No RNG involved. */
export function createStartingHero(): PartyMember {
  return {
    id: "hero-1",
    name: "Hero",
    level: 1,
    xp: 0,
    stats: { str: 5, agi: 5, vit: 5, int: 5 },
    hp: 20,
    maxHp: 20,
    mp: 10,
    maxMp: 10,
    equipment: {
      weapon: null,
      armor: null,
      accessory1: null,
      accessory2: null,
    },
  };
}
