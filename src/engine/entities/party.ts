/**
 * Party & economy data model (PROJECT_PLAN §4.2, §10; Phase 5, ROG-11;
 * character classes in ROG-17).
 *
 * PROJECT_PLAN §10 defers multi-member parties until the loop is proven, so
 * `newGame` only ever creates one hero. `party` is still modeled as an array
 * so battle/UI code written against it does not need to change shape later.
 *
 * Phase 5 equipment slots hold the full generated `ItemInstance` (not just an
 * id) so a save is self-contained: equipping moves an instance from the
 * backpack (`GameState.items`) into a slot, unequipping moves it back. Combat
 * reads effective stats via `src/engine/loot/equipment.ts`.
 *
 * ROG-17 adds `classId`: the hero's character class, which drives starting
 * stats/HP/MP, per-level growth, and starting skills via the `ClassDef` table
 * in `src/data/classes.ts`. `createStartingHero(classId)` builds a hero from a
 * ClassDef instead of hardcoded values; old saves without a `classId` are
 * backfilled to the default class (`warrior`) on load.
 */

import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import type { ItemInstance } from "../loot/types";

/** An equipped item instance occupying a slot, or `null` when the slot is empty. */
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
  /** Character class id (resolves via `findClass`); defaults to warrior on old saves. */
  classId: string;
  level: number;
  xp: number;
  stats: PartyMemberStats;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  equipment: PartyMemberEquipment;
}

/** An owned, unequipped stack of consumable items (potions, antidotes). */
export interface InventoryItem {
  itemId: string;
  quantity: number;
}

/**
 * Deterministic starting hero for a fresh run. No RNG involved. Stats, HP/MP,
 * and known skills all come from the `ClassDef` for `classId` (defaulting to
 * the default class), so adding a class is a data entry, not a code change.
 */
export function createStartingHero(
  classId: string = DEFAULT_CLASS_ID,
): PartyMember {
  const cls = findClass(classId) ?? findClass(DEFAULT_CLASS_ID);
  if (!cls) throw new Error(`${DEFAULT_CLASS_ID} class missing from data`);
  return {
    id: "hero-1",
    name: "Hero",
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
