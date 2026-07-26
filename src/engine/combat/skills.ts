import { findClass } from "../../data/classes";
import type { AppliedEffect, Element } from "./statusEffects";
import type { CoreStats } from "./types";

// Heal-cleanse decision (ENG-12): every "heal" kind skill also cleanses all
// of the caster's active status effects when cast (see the "skill" case in
// resolution.ts's applyMemberCommand). This makes MP-cost Heal skills a
// full-service response - HP plus every ailment - while single-status cure
// items (Antidote, Thermal Salts) stay the cheaper, targeted, MP-free option.
export type SkillKind = "attack" | "heal";
export type SkillTarget = "enemy" | "self";

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

  {
    id: "cleave",
    name: "Cleave",
    mpCost: 4,
    kind: "attack",
    power: 6,
    target: "enemy",
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
    target: "enemy",
    stat: "agi",
  },

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

export function classSkills(classId: string): SkillDef[] {
  const cls = findClass(classId);
  if (!cls) return [];
  return cls.skills
    .map((id) => findSkill(id))
    .filter((skill): skill is SkillDef => !!skill);
}
