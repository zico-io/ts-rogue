import type { SkillTreeDef } from "../../data/skillTrees";
import type { CoreStats } from "../combat/types";
import type { PartyMember } from "../entities/party";
import { unlockedNodeDefs } from "../entities/skillTree";
import { itemBaseSlot, itemStats } from "./items";
import type { EquipmentSlotName, ItemInstance } from "./types";

export type { EquipmentSlotName };

const SLOT_ORDER: readonly EquipmentSlotName[] = [
  "weapon",
  "armor",
  "accessory1",
  "accessory2",
];

// Base stats plus every equipped item's bonus plus every unlocked passive
// ("stat" type) skill tree node's bonus, so atkFrom/defFrom/spdFrom
// (../combat/resolution.ts) pick up spent skill points for free. `tree`
// overrides the member's resolved class tree so tests can exercise node
// aggregation against a fixture while SKILL_TREES has no starter content
// yet (ENG-35); a member with no unlocked nodes resolves exactly as before.
export function effectiveStats(
  member: PartyMember,
  tree?: SkillTreeDef,
): CoreStats {
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
  for (const node of unlockedNodeDefs(member, tree)) {
    if (node.type === "stat") total[node.stat] += node.amount;
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
