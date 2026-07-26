import { CLASSES } from "../../../data/classes";
import {
  charFromKey,
  type Intent,
  type Keymap,
  type KeyName,
} from "../../scene/input";
import { MAX_NAME_LENGTH, mainMenuOptions, type TitleView } from "./display";

export interface TitleUiState {
  view: TitleView;

  menuCursor: number;

  classCursor: number;

  modeCursor: number;

  nameInput: string;
}

export interface TitleUiContext {
  hasSave: boolean;
  defaultPermadeath: boolean;
  defaultHeroName: string;
}

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

const modeKeymap: Keymap = classKeymap;

const nameKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
  backspace: { kind: "backspace" },
  "ctrl+c": { kind: "quit" },
};

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
