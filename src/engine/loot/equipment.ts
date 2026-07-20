/**
 * Equipment helpers (PROJECT_PLAN Phase 5, ROG-11). Pure, UI-free logic for
 * equipping generated items and comparing them. `effectiveStats` is the bridge
 * between the loot system and combat: a party member's effective stat block is
 * their base stats plus every equipped item's stat bonus, so equipping a drop
 * raises the derived ATK/DEF/SPD the battle screen and combat resolver use.
 * Combat reads `effectiveStats` instead of raw `member.stats`; with no
 * equipment equipped it is identical to the base stats, so existing combat
 * behavior is unchanged.
 */

import type { CoreStats } from "../combat/types";
import type { PartyMember } from "../entities/party";
import { itemBaseSlot, itemStats } from "./items";
import type { EquipmentSlotName, ItemInstance } from "./types";

/** Re-exported so callers can name the slot union without importing types directly. */
export type { EquipmentSlotName };

const SLOT_ORDER: readonly EquipmentSlotName[] = [
  "weapon",
  "armor",
  "accessory1",
  "accessory2",
];

/**
 * A party member's effective stat block: base stats plus the bonus from every
 * equipped item. Pure. With all slots empty this equals `member.stats`.
 */
export function effectiveStats(member: PartyMember): CoreStats {
  const base = member.stats;
  const total: CoreStats = {
    str: base.str,
    agi: base.agi,
    vit: base.vit,
    int: base.int,
  };
  for (const slot of SLOT_ORDER) {
    const item = member.equipment[slot];
    if (!item) continue;
    const bonus = itemStats(item);
    total.str += bonus.str;
    total.agi += bonus.agi;
    total.vit += bonus.vit;
    total.int += bonus.int;
  }
  return total;
}

/**
 * The slot an item would equip into. Weapons and armor have a fixed slot;
 * accessories fill the first empty accessory slot, or swap accessory1 when both
 * are occupied. Returns `null` if the item's base is unknown.
 */
export function equipTargetSlot(
  member: PartyMember,
  item: ItemInstance,
): EquipmentSlotName | null {
  const slot = itemBaseSlot(item);
  if (!slot) return null;
  if (slot === "weapon") return "weapon";
  if (slot === "armor") return "armor";
  if (!member.equipment.accessory1) return "accessory1";
  if (!member.equipment.accessory2) return "accessory2";
  return "accessory1";
}

/**
 * Stat delta if `item` were equipped into its target slot versus the item
 * currently there. Positive numbers are gains. Used by the store compare panel.
 */
export function compareItem(
  member: PartyMember,
  item: ItemInstance,
): CoreStats {
  const target = equipTargetSlot(member, item);
  const current = target ? member.equipment[target] : null;
  const currentStats = current
    ? itemStats(current)
    : { str: 0, agi: 0, vit: 0, int: 0 };
  const newStats = itemStats(item);
  return {
    str: newStats.str - currentStats.str,
    agi: newStats.agi - currentStats.agi,
    vit: newStats.vit - currentStats.vit,
    int: newStats.int - currentStats.int,
  };
}
