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
  count: number;
}

const zoomKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

export function resolveZoomIntent(key: KeyName): Intent | undefined {
  return zoomKeymap[key];
}

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
