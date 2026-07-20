/**
 * Monster definitions (PROJECT_PLAN Phase 4, ROG-10; data table named in §7).
 *
 * Each monster is plain serializable data: base stats, HP/MP, XP/gold reward,
 * a difficulty tier, and first-person ASCII art drawn facing the viewer
 * (Wizardry/Dragon Quest style - the party sees the monster looking back at
 * them). Loot tables and monster-implicit item pools are Phase 5 (ROG-11) and
 * are intentionally absent here; Phase 4 battles only need stats, art, and
 * rewards.
 */

export interface MonsterStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  stats: MonsterStats;
  maxHp: number;
  maxMp: number;
  xp: number;
  gold: number;
  /** Lowest dungeon floor this monster appears on (wandering or boss). */
  minFloor: number;
  /** Difficulty tier; Phase 5 loot/implicit pools key off this. */
  tier: number;
  /** First-person ASCII art, line by line, facing the viewer. */
  ascii: readonly string[];
}

export const MONSTERS: readonly MonsterDef[] = [
  {
    id: "slime",
    name: "Slime",
    stats: { str: 4, agi: 3, vit: 4, int: 1 },
    maxHp: 12,
    maxMp: 0,
    xp: 5,
    gold: 3,
    minFloor: 1,
    tier: 1,
    ascii: ["   ___   ", "  /   \\  ", " | ~o~ | ", "  \\___/  "],
  },
  {
    id: "goblin",
    name: "Goblin",
    stats: { str: 7, agi: 6, vit: 4, int: 3 },
    maxHp: 22,
    maxMp: 0,
    xp: 12,
    gold: 8,
    minFloor: 2,
    tier: 2,
    ascii: [
      "   /\\    ",
      "  /oo\\   ",
      "  \\--/   ",
      "  /||\\   ",
      " /    \\  ",
    ],
  },
  {
    id: "dungeon-guardian",
    name: "Dungeon Guardian",
    stats: { str: 12, agi: 5, vit: 14, int: 2 },
    maxHp: 60,
    maxMp: 0,
    xp: 80,
    gold: 120,
    minFloor: 3,
    tier: 3,
    ascii: [
      "  /===\\  ",
      "  |O O|  ",
      "  |___|  ",
      " /|||\\   ",
      " |   |   ",
      " /___\\   ",
    ],
  },
];

export function findMonster(id: string): MonsterDef | undefined {
  return MONSTERS.find((monster) => monster.id === id);
}
