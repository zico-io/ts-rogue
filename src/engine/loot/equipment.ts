import type { CoreStats } from "../combat/types";
import type { PartyMember } from "../entities/party";
import { itemBaseSlot, itemStats } from "./items";
import type { EquipmentSlotName, ItemInstance } from "./types";

export type { EquipmentSlotName };

const SLOT_ORDER: readonly EquipmentSlotName[] = [
  "weapon",
  "armor",
  "accessory1",
  "accessory2",
];

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
