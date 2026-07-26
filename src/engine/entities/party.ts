import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import type { EffectInstance } from "../combat/statusEffects";
import type { ItemInstance } from "../loot/types";

export const MAX_PARTY = 4;

export type EquipmentSlot = ItemInstance | null;

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

  classId: string;
  level: number;
  xp: number;
  stats: PartyMemberStats;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  equipment: PartyMemberEquipment;

  effects?: EffectInstance[];
}

export interface InventoryItem {
  itemId: string;
  quantity: number;
}

export function createStartingHero(
  classId: string = DEFAULT_CLASS_ID,
  id: string = "hero-1",
  name: string = "Hero",
): PartyMember {
  const cls = findClass(classId) ?? findClass(DEFAULT_CLASS_ID);
  if (!cls) throw new Error(`${DEFAULT_CLASS_ID} class missing from data`);
  return {
    id,
    name,
    classId: cls.id,
    level: 1,
    xp: 0,
    stats: { ...cls.stats },
    hp: cls.maxHp,
    maxHp: cls.maxHp,
    mp: cls.maxMp,
    maxMp: cls.maxMp,
    equipment: {
      weapon: null,
      armor: null,
      accessory1: null,
      accessory2: null,
    },
  };
}
