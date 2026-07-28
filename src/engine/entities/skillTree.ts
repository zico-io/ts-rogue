import { findClass } from "../../data/classes";
import {
  findSkillTree,
  type SkillNodeDef,
  type SkillTreeDef,
} from "../../data/skillTrees";
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

// Resolves the member's class tree (ClassDef.treeId -> SKILL_TREES).
// Shared by unlockSkillNode and every unlockedNodeDefs caller (battle
// skill list, effectiveStats) so they all agree on which tree a member's
// unlocks belong to.
export function memberSkillTree(member: PartyMember): SkillTreeDef | undefined {
  const treeId = findClass(member.classId)?.treeId;
  return treeId === undefined ? undefined : findSkillTree(treeId);
}

// Node defs backing every id already in member.unlockedNodes, resolved
// against `tree` (defaults to the member's own class tree). Takes an
// explicit `tree` override so tests can exercise real node aggregation
// against a fixture tree while SKILL_TREES has no starter content yet
// (ENG-35); members with no unlocked nodes always resolve to [].
export function unlockedNodeDefs(
  member: PartyMember,
  tree: SkillTreeDef | undefined = memberSkillTree(member),
): SkillNodeDef[] {
  if (!tree) return [];
  return tree.nodes.filter((node) => member.unlockedNodes.includes(node.id));
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

// Resolves the member's class tree and validates/spends against it. A
// class with no matching tree yet resolves the same as any other unknown
// node id.
export function unlockSkillNode(
  member: PartyMember,
  nodeId: string,
): UnlockSkillNodeResult {
  return unlockNodeInTree(member, memberSkillTree(member), nodeId);
}
