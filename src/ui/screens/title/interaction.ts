/**
 * Title-flow input handling (ROG-55 RFC, ROG-56 core; extracted from
 * `app.tsx`'s title `useInput` closure).
 *
 * The title screen walks a small state machine: main menu -> (New Game)
 * class -> mode -> name, then a run starts. `reduceTitleUi` is the pure
 * transition function for that machine; `app.tsx` owns the single
 * `TitleUiState` and calls it once per resolved `Intent`. Settings is a
 * separate view with its own input handling (`SettingsScreen`); this module
 * only decides transitions between the four flow views (menu/class/mode/
 * name), even though `TitleUiState.view` can also hold `"settings"` so
 * `app.tsx` can store it in the same slot.
 *
 * `resolveTitleIntent` maps a normalized `KeyName` to an `Intent` for the
 * current view. Name entry accepts printable chars, so bare `q` must type
 * there instead of quitting - only Ctrl-C quits in the name view; Esc backs
 * out to mode selection.
 */

import { CLASSES } from "../../../data/classes";
import type { Intent, Keymap, KeyName } from "../../scene/input";
import {
  MAX_NAME_LENGTH,
  mainMenuOptions,
  type TitleView,
} from "../TitleScreen";

/** The title flow's full input state; `app.tsx` holds exactly one of these. */
export interface TitleUiState {
  view: TitleView;
  /** Selected main-menu index into `mainMenuOptions(hasSave)`. */
  menuCursor: number;
  /** Selected class index into `CLASSES`. */
  classCursor: number;
  /** Selected mode index (0 = Normal, 1 = Permadeath). */
  modeCursor: number;
  /** Hero-name buffer during the name view. */
  nameInput: string;
}

/** Data `reduceTitleUi` needs but doesn't own, sourced from settings/save state. */
export interface TitleUiContext {
  hasSave: boolean;
  defaultPermadeath: boolean;
  defaultHeroName: string;
}

/** Non-state-update side effects the title flow can request. */
export type TitleUiEffect =
  | { type: "startNewGame"; classId: string; permadeath: boolean; name: string }
  | { type: "continueGame" }
  | { type: "openSettings" }
  | { type: "quit" };

export interface TitleUiResult {
  state: TitleUiState;
  effect?: TitleUiEffect;
}

const menuKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  "ctrl+c": { kind: "quit" },
  q: { kind: "quit" },
};

const classKeymap: Keymap = {
  ...menuKeymap,
  escape: { kind: "cancel" },
};

// Mode view toggles a binary choice; either arrow flips it, so both bind to
// the same intent kind and the reducer treats menuUp/menuDown identically.
const modeKeymap: Keymap = classKeymap;

const nameKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
  backspace: { kind: "backspace" },
  "ctrl+c": { kind: "quit" },
};

/** Extracts the literal character a key press represents, if it is one. */
function charFromKey(key: KeyName): string | undefined {
  if (key.startsWith("char:")) return key.slice("char:".length);
  if (key.startsWith("digit:")) return key.slice("digit:".length);
  // Single-character key names (h, j, k, l, q, `) double as their own literal
  // character when typed during name entry.
  if (key.length === 1) return key;
  return undefined;
}

/**
 * Resolves the `Intent` for a key press given the current view. Name entry
 * has no static keymap for printable characters - the char space is
 * unbounded - so any key not bound in `nameKeymap` becomes a `type` intent
 * (or is ignored if it isn't a representable character, e.g. arrow keys).
 */
export function resolveTitleIntent(
  view: TitleView,
  key: KeyName,
): Intent | undefined {
  if (view === "name") {
    const bound = nameKeymap[key];
    if (bound) return bound;
    const char = charFromKey(key);
    return char === undefined ? undefined : { kind: "type", char };
  }
  if (view === "menu") return menuKeymap[key];
  if (view === "class") return classKeymap[key];
  if (view === "mode") return modeKeymap[key];
  return undefined;
}

/** Pure transition function for the title flow's menu/class/mode/name views. */
export function reduceTitleUi(
  state: TitleUiState,
  intent: Intent,
  ctx: TitleUiContext,
): TitleUiResult {
  if (intent.kind === "quit") return { state, effect: { type: "quit" } };

  switch (state.view) {
    case "menu": {
      const options = mainMenuOptions(ctx.hasSave);
      if (intent.kind === "menuUp") {
        return {
          state: {
            ...state,
            menuCursor:
              (state.menuCursor + options.length - 1) % options.length,
          },
        };
      }
      if (intent.kind === "menuDown") {
        return {
          state: {
            ...state,
            menuCursor: (state.menuCursor + 1) % options.length,
          },
        };
      }
      if (intent.kind === "confirm") {
        const option = options[state.menuCursor];
        if (option.id === "new") {
          return { state: { ...state, view: "class", classCursor: 0 } };
        }
        if (option.id === "continue") {
          return { state, effect: { type: "continueGame" } };
        }
        if (option.id === "settings") {
          return { state, effect: { type: "openSettings" } };
        }
        return { state, effect: { type: "quit" } };
      }
      return { state };
    }

    case "class": {
      if (intent.kind === "cancel") {
        return { state: { ...state, view: "menu" } };
      }
      if (intent.kind === "menuUp") {
        return {
          state: {
            ...state,
            classCursor:
              (state.classCursor + CLASSES.length - 1) % CLASSES.length,
          },
        };
      }
      if (intent.kind === "menuDown") {
        return {
          state: {
            ...state,
            classCursor: (state.classCursor + 1) % CLASSES.length,
          },
        };
      }
      if (intent.kind === "confirm") {
        return {
          state: {
            ...state,
            view: "mode",
            modeCursor: ctx.defaultPermadeath ? 1 : 0,
          },
        };
      }
      return { state };
    }

    case "mode": {
      if (intent.kind === "cancel") {
        return { state: { ...state, view: "class" } };
      }
      if (intent.kind === "menuUp" || intent.kind === "menuDown") {
        return {
          state: { ...state, modeCursor: state.modeCursor === 0 ? 1 : 0 },
        };
      }
      if (intent.kind === "confirm") {
        return {
          state: { ...state, view: "name", nameInput: ctx.defaultHeroName },
        };
      }
      return { state };
    }

    case "name": {
      if (intent.kind === "cancel") {
        return { state: { ...state, view: "mode" } };
      }
      if (intent.kind === "backspace") {
        return { state: { ...state, nameInput: state.nameInput.slice(0, -1) } };
      }
      if (intent.kind === "type") {
        if (state.nameInput.length >= MAX_NAME_LENGTH) return { state };
        return {
          state: { ...state, nameInput: state.nameInput + intent.char },
        };
      }
      if (intent.kind === "confirm") {
        const name = state.nameInput.trim();
        if (!name) return { state };
        return {
          state,
          effect: {
            type: "startNewGame",
            classId: CLASSES[state.classCursor].id,
            permadeath: state.modeCursor === 1,
            name,
          },
        };
      }
      return { state };
    }

    default:
      return { state };
  }
}
