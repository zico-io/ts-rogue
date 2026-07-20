/**
 * Player skill/spell definitions (PROJECT_PLAN Phase 4, ROG-10). Plain UI-free
 * data. A skill costs MP and either deals magic damage to one enemy (ignoring
 * defense, always hitting, with the seeded damage variance) or heals the
 * caster. The combat resolver reads these via `findSkill`; the battle screen
 * reads them to label the skill menu.
 */

export type SkillKind = "attack" | "heal";
export type SkillTarget = "enemy" | "self";

export interface SkillDef {
  id: string;
  name: string;
  mpCost: number;
  kind: SkillKind;
  target: SkillTarget;
  /**
   * Base power. Attack spells hit for `floor((power + int) * variance)` and
   * ignore defense; heal restores exactly `power + int`.
   */
  power: number;
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: "flame",
    name: "Flame",
    mpCost: 3,
    kind: "attack",
    power: 8,
    target: "enemy",
  },
  {
    id: "heal",
    name: "Heal",
    mpCost: 4,
    kind: "heal",
    power: 10,
    target: "self",
  },
];

export function findSkill(id: string): SkillDef | undefined {
  return SKILLS.find((skill) => skill.id === id);
}
