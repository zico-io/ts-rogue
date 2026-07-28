import { findClass } from "../../data/classes";
import type { SkillNodeDef } from "../../data/skillTrees";
import type { PartyMember } from "../entities/party";
import { unlockedNodeDefs } from "../entities/skillTree";
import type { AppliedEffect, Element } from "./statusEffects";
import type { CoreStats } from "./types";

// Heal-cleanse decision (ENG-12): every "heal" kind skill also cleanses all
// of the caster's active status effects when cast (see the "skill" case in
// resolution.ts's applyMemberCommand). This makes MP-cost Heal skills a
// full-service response - HP plus every ailment - while single-status cure
// items (Antidote, Thermal Salts) stay the cheaper, targeted, MP-free option.
export type SkillKind = "attack" | "heal";

// v2 target shape: describes who a skill can hit, not how it resolves.
// resolveShapeTargets in resolution.ts (ENG-28) expands every shape below
// into a concrete target list - "row" splashes one enemy row, "column"
// pierces the same lane in both rows, "allEnemies"/"allAllies" hit
// everyone living on that side, "randomN" hits `hitCount` random living
// targets, and "self"/"ally"/"allAllies" resolve against the caster's own
// side instead of the opposing one.
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

  // Target count for the "randomN" shape (picked without replacement, so
  // it's clamped to however many are alive). Unused by every other shape.
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

  // Shape-exercising skills (ENG-28): one skill per non-single shape,
  // enough to drive it through class content and the shared resolver.
  {
    id: "hailstorm",
    name: "Hailstorm",
    mpCost: 9,
    kind: "attack",
    power: 10,
    target: "row",
    stat: "int",
    element: "ice",
    applies: [{ effectId: "wet", chance: 0.5, duration: 3 }],
  },

  {
    id: "skewer",
    name: "Skewer",
    mpCost: 6,
    kind: "attack",
    power: 7,
    target: "column",
    stat: "str",
  },

  {
    id: "meteor",
    name: "Meteor",
    mpCost: 12,
    kind: "attack",
    power: 9,
    target: "allEnemies",
    stat: "int",
    element: "fire",
  },

  {
    id: "scattershot",
    name: "Scattershot",
    mpCost: 8,
    kind: "attack",
    power: 4,
    target: "randomN",
    stat: "agi",
    hitCount: 3,
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

// Base skill ids plus each active-unlock ("skill" type) node's skillId,
// deduped. Split out from memberSkills so the merge/dedup logic is directly
// testable against plain SkillNodeDef fixtures, without needing a full
// SkillTreeDef or SKILL_TREES to have real content yet (ENG-35).
export function skillIdsWithUnlocks(
  baseIds: readonly string[],
  unlockedNodes: readonly SkillNodeDef[],
): string[] {
  const unlockedIds = unlockedNodes
    .filter((node) => node.type === "skill")
    .map((node) => node.skillId);
  return [...new Set([...baseIds, ...unlockedIds])];
}

// Starting skills (ClassDef.skills) plus every active-unlock node the
// member has spent a point on, resolved through the shared SKILLS table.
// This is what the battle skill menu shows instead of the flat classSkills
// lookup; a member with no unlocked nodes resolves to exactly
// classSkills(member.classId).
export function memberSkills(member: PartyMember): SkillDef[] {
  const baseIds = findClass(member.classId)?.skills ?? [];
  return resolveSkillList(
    skillIdsWithUnlocks(baseIds, unlockedNodeDefs(member)),
  );
}
