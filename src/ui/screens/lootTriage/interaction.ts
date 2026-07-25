/**
 * Loot triage prompt input handling (ENG-2). Raised whenever a field drop
 * would overflow the backpack cap (`state.pendingLootTriage`, see
 * `loot/pickup.ts` and `state/store.ts`'s `resolveLootTriage`). The player
 * must resolve it - dismantle the new drop, or swap it for a carried item -
 * before anything else that touches the backpack; `app.tsx` gates every
 * other scene's input while this is open, the same way it gates `zoomOpen`.
 */

import type { Intent, Keymap, KeyName } from "../../scene/input";

/** `swapping` is true while the player is choosing which carried item to dismantle instead. */
export interface LootTriageUiState {
  swapping: boolean;
  cursor: number;
}

export const INITIAL_LOOT_TRIAGE_UI_STATE: LootTriageUiState = {
  swapping: false,
  cursor: 0,
};

export type LootTriageUiEffect =
  | { type: "dismantleDrop" }
  | { type: "swap"; index: number };

export interface LootTriageUiResult {
  state: LootTriageUiState;
  effect?: LootTriageUiEffect;
}

const chooseKeymap: Keymap = {
  "char:d": { kind: "dismantleDrop" },
  "char:s": { kind: "switchMode" },
};

const swapKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirmSwap" },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press, given whether the swap-target picker is open. */
export function resolveLootTriageIntent(
  swapping: boolean,
  key: KeyName,
): Intent | undefined {
  return swapping ? swapKeymap[key] : chooseKeymap[key];
}

/** Pure transition function for the loot triage prompt. */
export function reduceLootTriageUi(
  state: LootTriageUiState,
  intent: Intent,
  ctx: { carriedCount: number },
): LootTriageUiResult {
  if (!state.swapping) {
    if (intent.kind === "dismantleDrop") {
      return { state, effect: { type: "dismantleDrop" } };
    }
    if (intent.kind === "switchMode") {
      return { state: { swapping: true, cursor: 0 } };
    }
    return { state };
  }

  if (ctx.carriedCount === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        cursor: (state.cursor + ctx.carriedCount - 1) % ctx.carriedCount,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: { ...state, cursor: (state.cursor + 1) % ctx.carriedCount },
    };
  }
  if (intent.kind === "confirmSwap") {
    return {
      state,
      effect: {
        type: "swap",
        index: Math.min(state.cursor, ctx.carriedCount - 1),
      },
    };
  }
  if (intent.kind === "cancel") {
    return { state: { swapping: false, cursor: 0 } };
  }
  return { state };
}
