/**
 * Player skill/spell definitions (PROJECT_PLAN Phase 4, ROG-10; class-flavored
 * skills in ROG-17). Plain UI-free data. A skill costs MP and either deals
 * damage to one enemy (ignoring defense, always hitting, with the seeded
 * damage variance) or heals the caster. An optional `stat` selects which core
 * stat the skill scales with; it defaults to `int`, so the original Flame/Heal
 * behavior is unchanged. Class-flavored skills declare their stat so a
 * Warrior's Cleave scales off str, a Rogue's Backstab off agi, and a Wizard's
 * spells off int. The combat resolver reads these via `findSkill`; the battle
 * screen reads the hero's known skills via `classSkills` to list only the
 * class's starting skills.
 *
 * ENG-10 (status + element data model): an optional `element` tags a skill's
 * damage type (defaults to `physical` when omitted, so every existing skill
 * above is unaffected); an optional `applies` list declares status effects
 * the skill may inflict on hit. Resolution wiring that reads either field is
 * out of scope for ENG-10 - it lands in ENG-11+.
 *
 * ENG-21: Flame is now tagged `element: "fire"`; Frost is tagged
 * `element: "ice"` and applies "wet" on hit (ice-themed moisture).
 */
import { findClass } from "../../data/classes";
import type { AppliedEffect, Element } from "./statusEffects";
import type { CoreStats } from "./types";

export type SkillKind = "attack" | "heal";
export type SkillTarget = "enemy" | "self";
/** Keys of `CoreStats`; the core stat a skill's power scales with. */
export type CoreStatKey = keyof CoreStats;

export interface SkillDef {
  id: string;
  name: string;
  mpCost: number;
  kind: SkillKind;
  target: SkillTarget;
  /**
   * Base power. Attack skills hit for `floor((power + stat) * variance)` and
   * ignore defense; heal skills restore exactly `power + stat`.
   */
  power: number;
  /** Core stat the skill scales with; defaults to `int` when omitted. */
  stat?: CoreStatKey;
  /** Damage element; defaults to `physical` when omitted. */
  element?: Element;
  /** Status effects this skill may inflict on hit; omitted means none. */
  applies?: AppliedEffect[];
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: "flame",
    name: "Flame",
    mpCost: 3,
    kind: "attack",
    power: 8,
    target: "enemy",
    element: "fire",
  },
  {
    id: "heal",
    name: "Heal",
    mpCost: 4,
    kind: "heal",
    power: 10,
    target: "self",
  },
  // Wizard spell (ROG-17): a costlier int-scaled blast, ice-flavoured.
  {
    id: "frost",
    name: "Frost",
    mpCost: 7,
    kind: "attack",
    power: 14,
    target: "enemy",
    stat: "int",
    element: "ice",
    applies: [{ effectId: "wet", chance: 0.5, duration: 3 }],
  },
  // Warrior melee (ROG-17): a str-scaled power strike.
  {
    id: "cleave",
    name: "Cleave",
    mpCost: 4,
    kind: "attack",
    power: 6,
    target: "enemy",
    stat: "str",
  },
  // Warrior utility (ROG-17): a vit-scaled self heal.
  {
    id: "second-wind",
    name: "Second Wind",
    mpCost: 5,
    kind: "heal",
    power: 6,
    target: "self",
    stat: "vit",
  },
  // Rogue crit (ROG-17): a cheap agi-scaled strike.
  {
    id: "backstab",
    name: "Backstab",
    mpCost: 3,
    kind: "attack",
    power: 5,
    target: "enemy",
    stat: "agi",
  },
  // Rogue utility (ROG-17): a heavier agi-scaled finisher.
  {
    id: "pinpoint",
    name: "Pinpoint",
    mpCost: 6,
    kind: "attack",
    power: 9,
    target: "enemy",
    stat: "agi",
  },
];

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((skill) => skill.id === id);
}

/**
 * The skills a hero of `classId` knows at run start, resolved from the class's
 * `skills` ids through `findSkill`. The battle skill menu lists only these so
 * each class has distinct starting skills; adding a class is a data entry that
 * lists its skill ids, with no change here.
 */
export function classSkills(classId: string): SkillDef[] {
  const cls = findClass(classId);
  if (!cls) return [];
  return cls.skills
    .map((id) => findSkill(id))
    .filter((skill): skill is SkillDef => !!skill);
}
