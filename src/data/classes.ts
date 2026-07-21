/**
 * Character class definitions (ROG-17). Plain serializable content authored
 * separately from engine code, following the same const-table + lookup
 * convention as `MONSTERS` (`src/data/monsters.ts`) and `ITEM_BASES`
 * (`src/data/itemBases.ts`). A class fixes the hero's starting core stats,
 * starting HP/MP, per-level growth, and the skill ids known at run start.
 * `createStartingHero(classId)` builds a hero from a ClassDef and `grantXp`
 * reads per-class growth, so adding a class is one new entry here (plus its
 * skills in `SKILLS`) - no engine or UI code change. The title-screen class
 * selection and the battle skill menu iterate over this table / the class's
 * skill ids, so a 4th class is a data entry only.
 */
import type { CoreStats } from "../engine/combat/types";

/** Per-level growth for a class: HP/MP gained and each core stat gained. */
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
  /** Starting core stats at level 1. */
  stats: CoreStats;
  /** Starting max HP and max MP at level 1. */
  maxHp: number;
  maxMp: number;
  /** HP/MP and each core stat gained on every level-up. */
  growth: ClassGrowth;
  /** Skill ids the hero knows at run start (resolved through `findSkill`). */
  skills: readonly string[];
}

/**
 * The class assigned to a hero that has no `classId` (e.g. a pre-ROG-17 save).
 * `deserialize` backfills this so old saves load cleanly.
 */
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
