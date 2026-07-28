import { findClass } from "../../data/classes";
import { findSkillTree, type SkillTreeDef } from "../../data/skillTrees";
import type { PartyMember } from "./party";

// Why a spend attempt was rejected. Distinguishing these lets callers show a
// specific reason instead of a generic "can't unlock" message.
export type UnlockSkillNodeReason =
  | "unknown-node"
  | "already-unlocked"
  | "missing-prerequisite"
  | "insufficient-points";

export interface UnlockSkillNodeResult {
  member: PartyMember;
  reason?: UnlockSkillNodeReason;
}

// Core validation against an explicit tree, decoupled from the class/tree
// data lookup so it can be exercised directly against a fixture tree while
// SKILL_TREES itself is still empty (starter content ships in ENG-35). Never
// throws on invalid input, and returns the member unchanged plus a reason
// whenever the spend can't apply, so callers stay pure on rejection.
export function unlockNodeInTree(
  member: PartyMember,
  tree: SkillTreeDef | undefined,
  nodeId: string,
): UnlockSkillNodeResult {
  const node = tree?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { member, reason: "unknown-node" };

  if (member.unlockedNodes.includes(nodeId)) {
    return { member, reason: "already-unlocked" };
  }

  const hasAllPrereqs = node.prereqs.every((prereq) =>
    member.unlockedNodes.includes(prereq),
  );
  if (!hasAllPrereqs) return { member, reason: "missing-prerequisite" };

  if (member.skillPoints < node.cost) {
    return { member, reason: "insufficient-points" };
  }

  return {
    member: {
      ...member,
      skillPoints: member.skillPoints - node.cost,
      unlockedNodes: [...member.unlockedNodes, nodeId],
    },
  };
}

// Resolves the member's class tree (ClassDef.treeId -> SKILL_TREES) and
// validates/spends against it. A class with no matching tree yet resolves
// the same as any other unknown node id.
export function unlockSkillNode(
  member: PartyMember,
  nodeId: string,
): UnlockSkillNodeResult {
  const tree = findSkillTree(findClass(member.classId)?.treeId ?? "");
  return unlockNodeInTree(member, tree, nodeId);
}
