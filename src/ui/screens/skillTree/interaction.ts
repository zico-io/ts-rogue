import type { SkillNodeDef } from "../../../data/skillTrees";
import type { SkillNodeState } from "../../../engine/entities/skillTree";
import type { Intent, Keymap, KeyName } from "../../scene/input";

export interface SkillTreeUiState {
  memberIndex: number;
  cursor: number;
}

export const INITIAL_SKILL_TREE_UI_STATE: SkillTreeUiState = {
  memberIndex: 0,
  cursor: 0,
};

export type SkillTreeUiEffect =
  | { type: "unlock"; nodeId: string }
  | { type: "back" };

export interface SkillTreeUiResult {
  state: SkillTreeUiState;
  effect?: SkillTreeUiEffect;
}

export interface SkillTreeUiContext {
  partyLength: number;
  nodes: readonly SkillNodeDef[];

  // Parallel to `nodes`, one state per node at the current cursor's member.
  nodeStates: readonly SkillNodeState[];
}

const skillTreeKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

export function resolveSkillTreeIntent(key: KeyName): Intent | undefined {
  return skillTreeKeymap[key];
}

export function reduceSkillTreeUi(
  state: SkillTreeUiState,
  intent: Intent,
  ctx: SkillTreeUiContext,
): SkillTreeUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };

  if (intent.kind === "menuUp" && ctx.nodes.length > 0) {
    return {
      state: {
        ...state,
        cursor: (state.cursor + ctx.nodes.length - 1) % ctx.nodes.length,
      },
    };
  }
  if (intent.kind === "menuDown" && ctx.nodes.length > 0) {
    return {
      state: { ...state, cursor: (state.cursor + 1) % ctx.nodes.length },
    };
  }

  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return { state: { memberIndex: next, cursor: 0 } };
  }

  if (intent.kind === "confirm") {
    const node = ctx.nodes[state.cursor];
    if (node && ctx.nodeStates[state.cursor] === "unlockable") {
      return { state, effect: { type: "unlock", nodeId: node.id } };
    }
    return { state };
  }

  return { state };
}
