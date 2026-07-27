import { findClass } from "../../data/classes";
import type { AppliedEffect, Element } from "./statusEffects";
import type { CoreStats } from "./types";

// Heal-cleanse decision (ENG-12): every "heal" kind skill also cleanses all
// of the caster's active status effects when cast (see the "skill" case in
// resolution.ts's applyMemberCommand). This makes MP-cost Heal skills a
// full-service response - HP plus every ailment - while single-status cure
// items (Antidote, Thermal Salts) stay the cheaper, targeted, MP-free option.
export type SkillKind = "attack" | "heal";

// v2 target shape (ENG-30): describes who a skill can hit, not how it
// resolves. Only "single" and "self" are read by resolveBattleEvent /
// applyMemberCommand today - "row" | "column" | "allEnemies" | "randomN" |
// "ally" | "allAllies" are data-model-only until the follow-up resolution
// ticket (ENG-28) expands each shape into concrete target lists.
export type SkillTarget =
  | "single"
  | "row"
  | "column"
  | "allEnemies"
  | "randomN"
  | "self"
  | "ally"
  | "allAllies";

export type CoreStatKey = keyof CoreStats;

export interface SkillDef {
  id: string;
  name: string;
  mpCost: number;
  kind: SkillKind;
  target: SkillTarget;

  power: number;

  stat?: CoreStatKey;

  element?: Element;

  applies?: AppliedEffect[];

  // Number of separate hits/rolls a single cast makes; also doubles as the
  // target count for the "randomN" shape. Undefined/1 means today's single
  // hit. Unread until ENG-28 wires shape resolution.
  hitCount?: number;
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: "flame",
    name: "Flame",
    mpCost: 3,
    kind: "attack",
    power: 8,
    target: "single",
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

  {
    id: "frost",
    name: "Frost",
    mpCost: 7,
    kind: "attack",
    power: 14,
    target: "single",
    stat: "int",
    element: "ice",
    applies: [{ effectId: "wet", chance: 0.5, duration: 3 }],
  },

  {
    id: "cleave",
    name: "Cleave",
    mpCost: 4,
    kind: "attack",
    power: 6,
    target: "single",
    stat: "str",
  },

  {
    id: "second-wind",
    name: "Second Wind",
    mpCost: 5,
    kind: "heal",
    power: 6,
    target: "self",
    stat: "vit",
  },

  {
    id: "backstab",
    name: "Backstab",
    mpCost: 3,
    kind: "attack",
    power: 5,
    target: "single",
    stat: "agi",
  },

  {
    id: "pinpoint",
    name: "Pinpoint",
    mpCost: 6,
    kind: "attack",
    power: 9,
    target: "single",
    stat: "agi",
  },
];

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((skill) => skill.id === id);
}

// Shared id-list -> SkillDef[] resolver (ENG-30): class and monster skill
// lists both go through this one path against the same SKILLS table.
export function resolveSkillList(ids: readonly string[]): SkillDef[] {
  return ids
    .map((id) => findSkill(id))
    .filter((skill): skill is SkillDef => !!skill);
}

export function classSkills(classId: string): SkillDef[] {
  const cls = findClass(classId);
  if (!cls) return [];
  return resolveSkillList(cls.skills);
}
