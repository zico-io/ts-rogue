/**
 * Fast-travel picker input handling (ENG-1), mirroring the village
 * overview's "house menu" pattern (`village/interaction.ts`'s
 * `OverviewUiState`/`resolveOverviewIntent`/`reduceOverviewUi`): a cursor
 * over a list, Up/Down to move it, Enter to confirm, Escape to cancel.
 */

import type { Intent, Keymap, KeyName } from "../../scene/input";

export interface ZoomUiState {
  cursor: number;
}

export type ZoomUiEffect =
  | { type: "travel"; index: number }
  | { type: "close" };

export interface ZoomUiResult {
  state: ZoomUiState;
  effect?: ZoomUiEffect;
}

export interface ZoomUiContext {
  /** Number of waypoints currently listed; the cursor wraps modulo this. */
  count: number;
}

const zoomKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press on the fast-travel picker. */
export function resolveZoomIntent(key: KeyName): Intent | undefined {
  return zoomKeymap[key];
}

/** Pure transition function for the fast-travel picker's cursor. */
export function reduceZoomUi(
  state: ZoomUiState,
  intent: Intent,
  ctx: ZoomUiContext,
): ZoomUiResult {
  if (ctx.count === 0) {
    if (intent.kind === "cancel") return { state, effect: { type: "close" } };
    return { state };
  }
  if (intent.kind === "menuUp") {
    return { state: { cursor: (state.cursor + ctx.count - 1) % ctx.count } };
  }
  if (intent.kind === "menuDown") {
    return { state: { cursor: (state.cursor + 1) % ctx.count } };
  }
  if (intent.kind === "confirm") {
    return { state, effect: { type: "travel", index: state.cursor } };
  }
  if (intent.kind === "cancel") {
    return { state, effect: { type: "close" } };
  }
  return { state };
}
