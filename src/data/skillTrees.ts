import type { CoreStatKey } from "../engine/combat/skills";

interface SkillNodeBase {
  id: string;
  name: string;

  // Points required to unlock this node once its prerequisites are met.
  cost: number;

  // Ids of other nodes in the same tree that must already be unlocked.
  prereqs: readonly string[];
}

// Discriminated on `type`, matching the QuestObjective idiom (src/data/quests.ts).
// A node either unlocks an active skill (a ref into SKILLS, see
// src/engine/combat/skills.ts) or grants a passive core-stat delta - never both.
export type SkillNodeDef =
  | (SkillNodeBase & { type: "skill"; skillId: string })
  | (SkillNodeBase & { type: "stat"; stat: CoreStatKey; amount: number });

export interface SkillTreeDef {
  id: string;
  name: string;
  nodes: readonly SkillNodeDef[];
}

// Starter tree content ships in ENG-35 alongside the classes that reference
// it (ClassDef.treeId, src/data/classes.ts). This table intentionally starts
// empty: findSkillTree and the reference wiring only need to resolve, and
// adding a tree later is one array entry with no other code changes.
export const SKILL_TREES: readonly SkillTreeDef[] = [];

export function findSkillTree(id: string): SkillTreeDef | undefined {
  return SKILL_TREES.find((tree) => tree.id === id);
}
