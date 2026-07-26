import type { CoreStats } from "../engine/combat/types";

export interface ClassGrowth {
  hp: number;
  mp: number;
  str: number;
  agi: number;
  vit: number;
  int: number;
}

export interface ClassDef {
  id: string;
  name: string;
  description: string;

  stats: CoreStats;

  maxHp: number;
  maxMp: number;

  growth: ClassGrowth;

  skills: readonly string[];
}

export const DEFAULT_CLASS_ID = "warrior";

export const CLASSES: readonly ClassDef[] = [
  {
    id: "warrior",
    name: "Warrior",
    description: "A stalwart fighter who leans on strength and vitality.",
    stats: { str: 7, agi: 4, vit: 7, int: 2 },
    maxHp: 24,
    maxMp: 6,
    growth: { hp: 8, mp: 2, str: 2, agi: 1, vit: 2, int: 0 },
    skills: ["cleave", "second-wind"],
  },
  {
    id: "rogue",
    name: "Rogue",
    description: "A nimble skirmisher who strikes first and lives by agility.",
    stats: { str: 5, agi: 8, vit: 5, int: 3 },
    maxHp: 18,
    maxMp: 10,
    growth: { hp: 5, mp: 3, str: 1, agi: 2, vit: 1, int: 1 },
    skills: ["backstab", "pinpoint"],
  },
  {
    id: "wizard",
    name: "Wizard",
    description:
      "A scholar of arcane power who channels intellect into spells.",
    stats: { str: 3, agi: 4, vit: 4, int: 8 },
    maxHp: 14,
    maxMp: 18,
    growth: { hp: 4, mp: 6, str: 0, agi: 1, vit: 1, int: 2 },
    skills: ["flame", "heal", "frost"],
  },
];

export function findClass(id: string): ClassDef | undefined {
  return CLASSES.find((cls) => cls.id === id);
}
