import { describe, expect, it } from "vitest";
import { findMonster, MONSTERS } from "../../data/monsters";
import type { SkillTreeDef } from "../../data/skillTrees";
import { createStartingHero, type PartyMember } from "../entities/party";
import {
  classSkills,
  findSkill,
  memberSkills,
  resolveSkillList,
  SKILLS,
} from "./skills";

// Fixture tree mirroring the shape ENG-35 will ship in SKILL_TREES, used to
// exercise memberSkills against real node data while SKILL_TREES itself is
// still empty (see src/engine/entities/skillTree.test.ts for the same
// convention).
const TREE: SkillTreeDef = {
  id: "test-tree",
  name: "Test Tree",
  nodes: [
    {
      id: "unlock-cleave",
      name: "Unlock Cleave",
      cost: 1,
      prereqs: [],
      type: "skill",
      skillId: "cleave",
    },
    {
      id: "str-node",
      name: "Str Node",
      cost: 1,
      prereqs: [],
      type: "stat",
      stat: "str",
      amount: 3,
    },
  ],
};

function memberWith(overrides: Partial<PartyMember> = {}): PartyMember {
  return { ...createStartingHero("wizard"), ...overrides };
}

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

describe("memberSkills", () => {
  it("equals classSkills(classId) for a member with no unlocked nodes", () => {
    const member = memberWith();
    expect(memberSkills(member).map((s) => s.id)).toEqual(
      classSkills(member.classId).map((s) => s.id),
    );
  });

  it("adds an unlocked active-skill node's skill to the battle skill list", () => {
    const member = memberWith({ unlockedNodes: ["unlock-cleave"] });
    expect(memberSkills(member, TREE).map((s) => s.id)).toEqual([
      "flame",
      "heal",
      "frost",
      "hailstorm",
      "meteor",
      "cleave",
    ]);
  });

  it("does not duplicate a node's skill id already in the class's starting skills", () => {
    const warrior = { ...createStartingHero("warrior"), unlockedNodes: [] };
    const withNode = { ...warrior, unlockedNodes: ["unlock-cleave"] };
    expect(memberSkills(withNode, TREE).map((s) => s.id)).toEqual(
      memberSkills(warrior).map((s) => s.id),
    );
  });

  it("ignores a passive stat node - it never appears in the skill list", () => {
    const member = memberWith({ unlockedNodes: ["str-node"] });
    expect(memberSkills(member, TREE).map((s) => s.id)).toEqual(
      classSkills(member.classId).map((s) => s.id),
    );
  });
});
