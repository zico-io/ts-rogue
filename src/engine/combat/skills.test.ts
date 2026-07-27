import { describe, expect, it } from "vitest";
import { findMonster, MONSTERS } from "../../data/monsters";
import { classSkills, findSkill, resolveSkillList, SKILLS } from "./skills";

const SELF_TARGET_SKILL_IDS = new Set(["heal", "second-wind"]);

describe("SkillDef v2 target shape", () => {
  it("round-trips every existing skill through findSkill unchanged", () => {
    for (const skill of SKILLS) {
      expect(findSkill(skill.id)).toEqual(skill);
    }
  });

  it("keeps every migrated attack skill on the single-target shape", () => {
    for (const skill of SKILLS) {
      if (SELF_TARGET_SKILL_IDS.has(skill.id)) {
        expect(skill.target).toBe("self");
      } else {
        expect(skill.target).toBe("single");
      }
    }
  });

  it("leaves hitCount unset for every existing skill (single hit, no shape expansion yet)", () => {
    for (const skill of SKILLS) {
      expect(skill.hitCount).toBeUndefined();
    }
  });

  it("classSkills still resolves each class's skill ids to the same SkillDef", () => {
    expect(classSkills("wizard").map((skill) => skill.id)).toEqual([
      "flame",
      "heal",
      "frost",
    ]);
  });
});

describe("MonsterDef skill lists (ENG-30 data model only)", () => {
  it("lets a monster carry a skill list that resolves through the shared SKILLS table", () => {
    const guardian = findMonster("dungeon-guardian");
    expect(guardian?.skills).toEqual(["cleave"]);
    expect(resolveSkillList(guardian?.skills ?? [])).toEqual([
      findSkill("cleave"),
    ]);
  });

  it("leaves monsters without a skill list unaffected", () => {
    for (const monster of MONSTERS) {
      if (monster.skills === undefined) continue;
      expect(resolveSkillList(monster.skills).length).toBe(
        monster.skills.length,
      );
    }
  });
});
