import { describe, expect, it } from "vitest";
import { findSkill } from "../engine/combat/skills";
import type { SkillNodeDef, SkillTreeDef } from "./skillTrees";
import { findSkillTree, SKILL_TREES } from "./skillTrees";

describe("SKILL_TREES data table", () => {
  it("starts empty - starter tree content ships in ENG-35", () => {
    expect(SKILL_TREES).toEqual([]);
  });

  it("findSkillTree returns undefined while the table is empty", () => {
    expect(findSkillTree("warrior")).toBeUndefined();
    expect(findSkillTree("nope")).toBeUndefined();
  });

  it("every skill-unlock node in a defined tree resolves against SKILLS", () => {
    for (const tree of SKILL_TREES) {
      for (const node of tree.nodes) {
        if (node.type === "skill") {
          expect(findSkill(node.skillId)).toBeDefined();
        }
      }
    }
  });

  it("every node's prereqs reference another node id in the same tree", () => {
    for (const tree of SKILL_TREES) {
      const ids = new Set(tree.nodes.map((node) => node.id));
      for (const node of tree.nodes) {
        for (const prereq of node.prereqs) {
          expect(ids.has(prereq)).toBe(true);
        }
      }
    }
  });

  it("supports both a skill-unlock and a stat-bonus node shape", () => {
    const skillNode: SkillNodeDef = {
      id: "n1",
      name: "Node 1",
      cost: 1,
      prereqs: [],
      type: "skill",
      skillId: "cleave",
    };
    const statNode: SkillNodeDef = {
      id: "n2",
      name: "Node 2",
      cost: 1,
      prereqs: ["n1"],
      type: "stat",
      stat: "str",
      amount: 2,
    };
    const tree: SkillTreeDef = {
      id: "smoke-tree",
      name: "Smoke Tree",
      nodes: [skillNode, statNode],
    };
    expect(tree.nodes.map((node) => node.type)).toEqual(["skill", "stat"]);
  });
});
