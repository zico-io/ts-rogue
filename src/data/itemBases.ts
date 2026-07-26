import type { ItemBaseDef } from "../engine/loot/types";

export const ITEM_BASES: readonly ItemBaseDef[] = [
  {
    id: "rusty-dagger",
    name: "Rusty Dagger",
    slot: "weapon",
    ilvl: 1,
    stats: { str: 1 },
    baseValue: 5,
  },
  {
    id: "iron-sword",
    name: "Iron Sword",
    slot: "weapon",
    ilvl: 5,
    stats: { str: 3 },
    baseValue: 12,
  },
  {
    id: "war-blade",
    name: "War Blade",
    slot: "weapon",
    ilvl: 10,
    stats: { str: 5 },
    baseValue: 25,
  },

  {
    id: "tunic",
    name: "Tunic",
    slot: "armor",
    ilvl: 1,
    stats: { vit: 1 },
    baseValue: 5,
  },
  {
    id: "leather-vest",
    name: "Leather Vest",
    slot: "armor",
    ilvl: 5,
    stats: { vit: 3 },
    baseValue: 12,
  },
  {
    id: "plate-mail",
    name: "Plate Mail",
    slot: "armor",
    ilvl: 10,
    stats: { vit: 5 },
    baseValue: 25,
  },

  {
    id: "copper-ring",
    name: "Copper Ring",
    slot: "accessory",
    ilvl: 1,
    stats: { agi: 1 },
    baseValue: 5,
  },
  {
    id: "silver-pendant",
    name: "Silver Pendant",
    slot: "accessory",
    ilvl: 5,
    stats: { agi: 2, int: 1 },
    baseValue: 15,
  },

  {
    id: "guardian-bulwark",
    name: "Guardian's Bulwark",
    slot: "armor",
    ilvl: 12,
    stats: { vit: 6 },
    baseValue: 30,
  },
  {
    id: "guardian-greatsword",
    name: "Guardian's Greatsword",
    slot: "weapon",
    ilvl: 12,
    stats: { str: 6 },
    baseValue: 30,
  },
  {
    id: "guardian-signet",
    name: "Guardian's Signet",
    slot: "accessory",
    ilvl: 12,
    stats: { agi: 3, int: 3 },
    baseValue: 30,
  },
  {
    id: "slime-ooze-charm",
    name: "Slime Ooze Charm",
    slot: "accessory",
    ilvl: 6,
    stats: { vit: 2, agi: 1 },
    baseValue: 18,
  },
  {
    id: "slime-gel-armor",
    name: "Slime Gel Armor",
    slot: "armor",
    ilvl: 4,
    stats: { vit: 2 },
    baseValue: 14,
  },
];

export function findItemBase(id: string): ItemBaseDef | undefined {
  return ITEM_BASES.find((base) => base.id === id);
}
