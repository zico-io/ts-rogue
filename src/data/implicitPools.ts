import type { MonsterImplicitPool } from "../engine/loot/types";

export const IMPLICIT_POOLS: readonly MonsterImplicitPool[] = [
  {
    sourceId: "boss_dungeon_guardian",
    dropChance: 1,
    items: [
      {
        baseId: "guardian-bulwark",
        weight: 2,
        rarity: "unique",
        implicitAffixId: "sig-warding",
      },
      {
        baseId: "guardian-greatsword",
        weight: 2,
        rarity: "unique",
        implicitAffixId: "sig-might",
      },
      {
        baseId: "guardian-signet",
        weight: 1,
        rarity: "unique",
        implicitAffixId: "sig-foresight",
      },
    ],
  },
  {
    sourceId: "type_slime",
    dropChance: 0.08,
    rarityWeights: { common: 40, magic: 40, rare: 18, unique: 2 },
    items: [
      { baseId: "slime-ooze-charm", weight: 3, implicitAffixId: "sig-ooze" },
      { baseId: "slime-gel-armor", weight: 2, implicitAffixId: "sig-ooze" },
    ],
  },
];

export function findImplicitPool(id: string): MonsterImplicitPool | undefined {
  return IMPLICIT_POOLS.find((pool) => pool.sourceId === id);
}
