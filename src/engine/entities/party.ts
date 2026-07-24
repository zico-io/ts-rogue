/**
 * Party & economy data model (PROJECT_PLAN §4.2, §10; Phase 5, ROG-11;
 * character classes in ROG-17; multi-member party in ROG-20).
 *
 * `party` is modeled as an array of up to 4 members. `newGame` still only ever
 * creates one starting hero; additional members are added at runtime (e.g.
 * `recruitMember` in `src/engine/state/store.ts`) via `createStartingHero`
 * with a distinct id/name.
 *
 * Phase 5 equipment slots hold the full generated `ItemInstance` (not just an
 * id) so a save is self-contained: equipping moves an instance from the
 * backpack (`GameState.items`) into a slot, unequipping moves it back. Combat
 * reads effective stats via `src/engine/loot/equipment.ts`.
 *
 * ROG-17 adds `classId`: a member's character class, which drives starting
 * stats/HP/MP, per-level growth, and starting skills via the `ClassDef` table
 * in `src/data/classes.ts`. `createStartingHero(classId)` builds a member from
 * a ClassDef instead of hardcoded values; old saves without a `classId` are
 * backfilled to the default class (`warrior`) on load.
 */

import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import type { ItemInstance } from "../loot/types";

/** Maximum number of members in the party (hero + up to three recruits). */
export const MAX_PARTY = 4;

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
 * Deterministic starting hero/member for a fresh run or a recruit. No RNG
 * involved. Stats, HP/MP, and known skills all come from the `ClassDef` for
 * `classId` (defaulting to the default class), so adding a class is a data
 * entry, not a code change. `id`/`name` default to the original single-hero
 * values so `newGame`'s call site is unaffected; callers adding a second (or
 * later) member pass a distinct id/name.
 */
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
