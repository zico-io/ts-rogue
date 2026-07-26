/**
 * Loot-triage overlay input handling (ENG-5, workstream 3 of the ENG-2
 * inventory epic). Mirrors the normalize-input / resolve-intent / pure-
 * reduce / dispatch-effect pattern every other screen uses (closest
 * template: `screens/inventory/interaction.ts`). `choose` offers swap
 * (dismantle a carried item to make room) or dismantle the drop directly;
 * `swapPick` lets the player pick which carried item to dismantle before
 * confirming. There is deliberately no "do nothing" exit from either mode -
 * the queued drop is always resolved one way or the other so nothing is
 * ever silently lost.
 */

import type { ItemInstance } from "../../../engine/loot/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

export type LootTriageMode = "choose" | "swapPick";

export interface LootTriageUiState {
  mode: LootTriageMode;
  carriedCursor: number;
}

export const INITIAL_LOOT_TRIAGE_UI_STATE: LootTriageUiState = {
  mode: "choose",
  carriedCursor: 0,
};

export interface LootTriageUiContext {
  carried: readonly ItemInstance[];
}

export type LootTriageUiEffect =
  | { type: "dismantleDrop" }
  | { type: "dismantleCarried"; instanceId: string };

export interface LootTriageUiResult {
  state: LootTriageUiState;
  effect?: LootTriageUiEffect;
}

const chooseKeymap: Keymap = {
  "char:s": { kind: "chooseSwap" },
  "char:d": { kind: "chooseDismantleDrop" },
};

const swapPickKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press on the loot-triage overlay, given its current mode. */
export function resolveLootTriageIntent(
  mode: LootTriageMode,
  key: KeyName,
): Intent | undefined {
  return mode === "choose" ? chooseKeymap[key] : swapPickKeymap[key];
}

/** Pure transition function for the loot-triage overlay's choose/swapPick modes. */
export function reduceLootTriageUi(
  state: LootTriageUiState,
  intent: Intent,
  ctx: LootTriageUiContext,
): LootTriageUiResult {
  if (state.mode === "choose") {
    if (intent.kind === "chooseSwap") {
      return { state: { mode: "swapPick", carriedCursor: 0 } };
    }
    if (intent.kind === "chooseDismantleDrop") {
      return { state, effect: { type: "dismantleDrop" } };
    }
    return { state };
  }

  // mode === "swapPick"
  if (intent.kind === "cancel") {
    return { state: { mode: "choose", carriedCursor: 0 } };
  }
  if (ctx.carried.length === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        carriedCursor:
          (state.carriedCursor + ctx.carried.length - 1) % ctx.carried.length,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        carriedCursor: (state.carriedCursor + 1) % ctx.carried.length,
      },
    };
  }
  if (intent.kind === "confirm") {
    const index = Math.min(state.carriedCursor, ctx.carried.length - 1);
    const selected = ctx.carried[index];
    return selected
      ? {
          state,
          effect: { type: "dismantleCarried", instanceId: selected.instanceId },
        }
      : { state };
  }
  return { state };
}
