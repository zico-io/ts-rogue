import type { AppliedEffect, Element } from "../engine/combat/statusEffects";

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

  minFloor: number;

  tier: number;

  lootTableRef: string;

  implicitPoolRef?: string;

  ascii: readonly string[];

  color: string;

  attackElement?: Element;

  attackApplies?: AppliedEffect[];

  sprite?: string;

  // Skill ids into the shared SKILLS table (see src/engine/combat/skills.ts).
  // Data-model only for now (ENG-30) - no battle logic reads this yet; the
  // follow-up resolution ticket (ENG-28) wires monster ability usage.
  skills?: readonly string[];
}

export const MONSTERS: readonly MonsterDef[] = [
  {
    id: "slime",
    name: "Slime",
    stats: { str: 4, agi: 3, vit: 4, int: 1 },
    maxHp: 12,
    maxMp: 0,
    xp: 5,
    gold: 5,
    minFloor: 1,
    tier: 1,
    lootTableRef: "tier-1",
    implicitPoolRef: "type_slime",
    sprite: "slime",
    ascii: [
      "       .-~~~-.",
      "   .-~~       ~~-.",
      "  /   (o)   (o)   \\",
      " |                 |",
      " |   \\.       ./   |",
      "  \\    ~-.-.-~    /",
      "   ~-.________.-~",
    ],
    color: "#53c09f",
    attackApplies: [{ effectId: "poison", chance: 0.3, duration: 3 }],
  },
  {
    id: "goblin",
    name: "Goblin",
    stats: { str: 7, agi: 6, vit: 4, int: 3 },
    maxHp: 22,
    maxMp: 0,
    xp: 12,
    gold: 12,
    minFloor: 2,
    tier: 2,
    lootTableRef: "tier-2",
    sprite: "goblin",
    ascii: [
      "     /\\      /\\",
      "    /  \\.--./  \\",
      "    | (o)  (o) |",
      "    |    __    |",
      "    \\   \\__/   /",
      "     |~~~~~~~~|",
      "    /|  |__|  |\\",
      "   / |__|  |__| \\",
      "     (__)  (__)",
    ],
    color: "#5fae3b",
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
    lootTableRef: "tier-3",
    implicitPoolRef: "boss_dungeon_guardian",
    sprite: "dungeon-guardian",
    ascii: [
      "       ______",
      "      /|====|\\",
      "     | |[][]| |",
      "      \\|====|/",
      "    .--|    |--.",
      "   /   |----|   \\",
      "  |  / |    | \\  |",
      "  | |  |    |  | |",
      "  |_|  |----|  |_|",
      "       |    |",
      "      _|____|_",
    ],
    color: "#e74343",
    // Cleave (single) is its default strike; Meteor (allEnemies) is its
    // room-clearing blast, both cast through the same shape resolver a
    // party member's BattleSkill command uses (ENG-28).
    skills: ["cleave", "meteor"],
  },
];

export function findMonster(id: string): MonsterDef | undefined {
  return MONSTERS.find((monster) => monster.id === id);
}
