import { describe, expect, it } from "vitest";
import type { SkillTreeDef } from "../../data/skillTrees";
import { createStartingHero, type PartyMember } from "./party";
import { unlockNodeInTree, unlockSkillNode } from "./skillTree";

const TREE: SkillTreeDef = {
  id: "test-tree",
  name: "Test Tree",
  nodes: [
    {
      id: "root",
      name: "Root",
      cost: 1,
      prereqs: [],
      type: "stat",
      stat: "str",
      amount: 1,
    },
    {
      id: "branch",
      name: "Branch",
      cost: 2,
      prereqs: ["root"],
      type: "skill",
      skillId: "cleave",
    },
  ],
};

function memberWith(overrides: Partial<PartyMember> = {}): PartyMember {
  return { ...createStartingHero(), skillPoints: 3, ...overrides };
}

describe("unlockNodeInTree", () => {
  it("rejects an unknown node id and leaves the member unchanged", () => {
    const member = memberWith();
    const result = unlockNodeInTree(member, TREE, "nope");
    expect(result.reason).toBe("unknown-node");
    expect(result.member).toEqual(member);
  });

  it("rejects when a tree is undefined (class has no tree yet)", () => {
    const member = memberWith();
    const result = unlockNodeInTree(member, undefined, "root");
    expect(result.reason).toBe("unknown-node");
    expect(result.member).toEqual(member);
  });

  it("rejects a node whose prerequisite is not yet unlocked", () => {
    const member = memberWith();
    const result = unlockNodeInTree(member, TREE, "branch");
    expect(result.reason).toBe("missing-prerequisite");
    expect(result.member).toEqual(member);
  });

  it("rejects when the member doesn't have enough points", () => {
    const member = memberWith({ skillPoints: 0 });
    const result = unlockNodeInTree(member, TREE, "root");
    expect(result.reason).toBe("insufficient-points");
    expect(result.member).toEqual(member);
  });

  it("rejects a node that is already unlocked", () => {
    const member = memberWith({ unlockedNodes: ["root"] });
    const result = unlockNodeInTree(member, TREE, "root");
    expect(result.reason).toBe("already-unlocked");
    expect(result.member).toEqual(member);
  });

  it("spends a point and records the unlock for a valid node", () => {
    const member = memberWith();
    const result = unlockNodeInTree(member, TREE, "root");
    expect(result.reason).toBeUndefined();
    expect(result.member.skillPoints).toBe(2);
    expect(result.member.unlockedNodes).toEqual(["root"]);
  });

  it("unlocks a node whose prerequisite is already satisfied", () => {
    const member = memberWith({ unlockedNodes: ["root"] });
    const result = unlockNodeInTree(member, TREE, "branch");
    expect(result.reason).toBeUndefined();
    expect(result.member.skillPoints).toBe(1);
    expect(result.member.unlockedNodes).toEqual(["root", "branch"]);
  });
});

describe("unlockSkillNode", () => {
  it("resolves undefined for classes until SKILL_TREES ships content (ENG-35)", () => {
    const member = memberWith();
    const result = unlockSkillNode(member, "any-node");
    expect(result.reason).toBe("unknown-node");
    expect(result.member).toEqual(member);
  });

  it("short-circuits on an unresolvable classId without a stringly-typed lookup", () => {
    const member = memberWith({ classId: "not-a-real-class" });
    const result = unlockSkillNode(member, "any-node");
    expect(result.reason).toBe("unknown-node");
    expect(result.member).toEqual(member);
  });
});
