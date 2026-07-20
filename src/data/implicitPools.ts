/**
 * Monster-implicit pool definitions (PROJECT_PLAN Phase 5, ROG-11; data table
 * named in section 7). Dedicated, infrequent drops tied to a specific source so
 * players have a reason to re-run a specific dungeon. Two kinds, mirroring the
 * Grim Dawn distinction:
 *
 * - Type pools (`sourceId: "type_..."`) attach to an enemy TYPE and can drop
 *   from any of that type across the world. Their `dropChance` is intentionally
 *   infrequent (e.g. 0.08).
 * - Boss pools (`sourceId: "boss_..."`) attach to a unique BOSS (single
 *   source). Their `dropChance` is reliable so a boss kill yields one of its
 *   1-3 signature items; re-running chases a different signature or better
 *   affix rolls.
 *
 * Each signature item forces a rarity and carries a fixed `implicitAffixId` on
 * top of its rolled affixes - the hook that makes the drop recognizably that
 * monster's.
 */

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
