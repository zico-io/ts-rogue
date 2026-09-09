import type { SkillDef } from "../../../engine/combat/skills";
import type { Intent, Keymap, KeyName } from "../../scene/input";

export const ACTIONS = ["Attack", "Skill", "Item", "Defend", "Flee"] as const;

export type BattleMode = "action" | "skill" | "item" | "target";

export interface BattleUiState {
  mode: BattleMode;
  actionCursor: number;
  skillCursor: number;
  itemCursor: number;
  targetCursor: number;
  pendingSkill: string | null;
}

export const INITIAL_BATTLE_UI_STATE: BattleUiState = {
  mode: "action",
  actionCursor: 0,
  skillCursor: 0,
  itemCursor: 0,
  targetCursor: 0,
  pendingSkill: null,
};

export interface BattleUiContext {
  actorId: string;
  actorMp: number;
  knownSkills: readonly SkillDef[];
  aliveEnemyIds: readonly string[];
  usableItemIds: readonly string[];
}

export type BattleUiEffect =
  | { type: "defend" }
  | { type: "flee" }
  | { type: "attack"; targetId: string }
  | { type: "skill"; skillId: string; targetId: string }
  | { type: "item"; itemId: string; targetId: string };

export interface BattleUiResult {
  state: BattleUiState;
  effect?: BattleUiEffect;
}

const battleKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

export function resolveBattleIntent(key: KeyName): Intent | undefined {
  return battleKeymap[key];
}

export function reduceBattleUi(
  state: BattleUiState,
  intent: Intent,
  ctx: BattleUiContext,
): BattleUiResult {
  if (intent.kind === "cancel") {
    if (state.mode === "action") return { state };
    return { state: { ...state, mode: "action", pendingSkill: null } };
  }

  if (state.mode === "action") {
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          actionCursor:
            (state.actionCursor + ACTIONS.length - 1) % ACTIONS.length,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          actionCursor: (state.actionCursor + 1) % ACTIONS.length,
        },
      };
    }
    if (intent.kind === "confirm") {
      switch (ACTIONS[state.actionCursor]) {
        case "Attack":
          return {
            state: {
              ...state,
              mode: "target",
              targetCursor: 0,
              pendingSkill: null,
            },
          };
        case "Skill":
          return { state: { ...state, mode: "skill", skillCursor: 0 } };
        case "Item":
          return { state: { ...state, mode: "item", itemCursor: 0 } };
        case "Defend":
          return {
            state: INITIAL_BATTLE_UI_STATE,
            effect: { type: "defend" },
          };
        case "Flee":
          return {
            state: INITIAL_BATTLE_UI_STATE,
            effect: { type: "flee" },
          };
      }
    }
    return { state };
  }

  if (state.mode === "skill") {
    const skillCount = ctx.knownSkills.length;
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          skillCursor: (state.skillCursor + skillCount - 1) % skillCount,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: { ...state, skillCursor: (state.skillCursor + 1) % skillCount },
      };
    }
    if (intent.kind === "confirm") {
      const skill = ctx.knownSkills[state.skillCursor];
      if (skill && ctx.actorMp >= skill.mpCost) {
        // single/row/column all need a target cursor: single picks the one
        // enemy hit, row/column pick the anchor (row or lane) the shape
        // expands from (TER-3). allEnemies/randomN have nothing to aim -
        // they fire straight at the caster's own id, which the resolver
        // ignores for those shapes.
        if (
          skill.target === "single" ||
          skill.target === "row" ||
          skill.target === "column"
        ) {
          return {
            state: {
              ...state,
              mode: "target",
              targetCursor: 0,
              pendingSkill: skill.id,
            },
          };
        }
        return {
          state: INITIAL_BATTLE_UI_STATE,
          effect: {
            type: "skill",
            skillId: skill.id,
            targetId: ctx.actorId,
          },
        };
      }
    }
    return { state };
  }

  if (state.mode === "item") {
    if (ctx.usableItemIds.length === 0) return { state };
    const itemCount = ctx.usableItemIds.length;
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          itemCursor: (state.itemCursor + itemCount - 1) % itemCount,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: { ...state, itemCursor: (state.itemCursor + 1) % itemCount },
      };
    }
    if (intent.kind === "confirm") {
      const itemId = ctx.usableItemIds[state.itemCursor];
      if (itemId) {
        return {
          state: INITIAL_BATTLE_UI_STATE,
          effect: { type: "item", itemId, targetId: ctx.actorId },
        };
      }
    }
    return { state };
  }

  if (ctx.aliveEnemyIds.length === 0) {
    return { state: { ...state, mode: "action" } };
  }
  const enemyCount = ctx.aliveEnemyIds.length;
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        targetCursor: (state.targetCursor + enemyCount - 1) % enemyCount,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: { ...state, targetCursor: (state.targetCursor + 1) % enemyCount },
    };
  }
  if (intent.kind === "confirm") {
    const targetId = ctx.aliveEnemyIds[state.targetCursor];
    if (targetId) {
      if (state.pendingSkill) {
        return {
          state: INITIAL_BATTLE_UI_STATE,
          effect: {
            type: "skill",
            skillId: state.pendingSkill,
            targetId,
          },
        };
      }
      return {
        state: INITIAL_BATTLE_UI_STATE,
        effect: { type: "attack", targetId },
      };
    }
  }
  return { state };
}
