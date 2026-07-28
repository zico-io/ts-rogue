import { describe, expect, it } from "vitest";
import { findMonster, MONSTERS } from "../../data/monsters";
import type { SkillNodeDef } from "../../data/skillTrees";
import { createStartingHero } from "../entities/party";
import {
  classSkills,
  findSkill,
  memberSkills,
  resolveSkillList,
  SKILLS,
  skillIdsWithUnlocks,
} from "./skills";

const ACTIVE_NODE: SkillNodeDef = {
  id: "unlock-cleave",
  name: "Unlock Cleave",
  cost: 1,
  prereqs: [],
  type: "skill",
  skillId: "cleave",
};
const PASSIVE_NODE: SkillNodeDef = {
  id: "str-node",
  name: "Str Node",
  cost: 1,
  prereqs: [],
  type: "stat",
  stat: "str",
  amount: 3,
};

// Every skill's expected v2 shape (ENG-28 wires each one into a concrete
// resolveShapeTargets case in resolution.ts).
const EXPECTED_SKILL_TARGETS: Record<string, string> = {
  flame: "single",
  heal: "self",
  frost: "single",
  cleave: "single",
  "second-wind": "self",
  backstab: "single",
  pinpoint: "single",
  hailstorm: "row",
  skewer: "column",
  meteor: "allEnemies",
  scattershot: "randomN",
};

describe("SkillDef v2 target shape", () => {
  it("round-trips every existing skill through findSkill unchanged", () => {
    for (const skill of SKILLS) {
      expect(findSkill(skill.id)).toEqual(skill);
    }
  });

  it("assigns every skill its expected target shape", () => {
    expect(SKILLS.map((skill) => skill.id).sort()).toEqual(
      Object.keys(EXPECTED_SKILL_TARGETS).sort(),
    );
    for (const skill of SKILLS) {
      expect(skill.target).toBe(EXPECTED_SKILL_TARGETS[skill.id]);
    }
  });

  it("only the randomN skill carries a hitCount, clamping its target count", () => {
    for (const skill of SKILLS) {
      if (skill.target === "randomN") {
        expect(skill.hitCount).toBeGreaterThan(1);
      } else {
        expect(skill.hitCount).toBeUndefined();
      }
    }
  });

  it("classSkills still resolves each class's skill ids to the same SkillDef", () => {
    expect(classSkills("wizard").map((skill) => skill.id)).toEqual([
      "flame",
      "heal",
      "frost",
      "hailstorm",
      "meteor",
    ]);
  });
});

describe("MonsterDef skill lists", () => {
  it("lets a monster carry a skill list that resolves through the shared SKILLS table", () => {
    const guardian = findMonster("dungeon-guardian");
    expect(guardian?.skills).toEqual(["cleave", "meteor"]);
    expect(resolveSkillList(guardian?.skills ?? [])).toEqual([
      findSkill("cleave"),
      findSkill("meteor"),
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

describe("skillIdsWithUnlocks", () => {
  it("appends an unlocked active-skill node's skillId to the base ids", () => {
    expect(skillIdsWithUnlocks(["flame", "heal"], [ACTIVE_NODE])).toEqual([
      "flame",
      "heal",
      "cleave",
    ]);
  });

  it("does not duplicate a node's skill id already in the base ids", () => {
    expect(skillIdsWithUnlocks(["cleave", "skewer"], [ACTIVE_NODE])).toEqual([
      "cleave",
      "skewer",
    ]);
  });

  it("ignores a passive stat node - it contributes no skill id", () => {
    expect(skillIdsWithUnlocks(["flame"], [PASSIVE_NODE])).toEqual(["flame"]);
  });

  it("returns exactly the base ids with no unlocked nodes", () => {
    expect(skillIdsWithUnlocks(["flame", "heal"], [])).toEqual([
      "flame",
      "heal",
    ]);
  });
});

describe("memberSkills", () => {
  it("equals classSkills(classId) for a member with no unlocked nodes", () => {
    const member = createStartingHero("wizard");
    expect(memberSkills(member).map((s) => s.id)).toEqual(
      classSkills(member.classId).map((s) => s.id),
    );
  });
});
