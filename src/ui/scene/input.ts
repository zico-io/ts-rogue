import type { Scene } from "../../engine/state/types";

export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "h"
  | "j"
  | "k"
  | "l"
  | "enter"
  | "escape"
  | "backspace"
  | "tab"
  | "`"
  | "q"
  | "ctrl+c"
  | `digit:${string}`
  | `char:${string}`;

export type Intent =
  | { kind: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "menuUp" | "menuDown" | "menuLeft" | "menuRight" }
  | { kind: "confirm" | "cancel" }
  | { kind: "changeScene"; scene: Scene }
  | { kind: "toggleConsole" }
  | { kind: "quit" }
  | { kind: "openZoom" }
  | { kind: "openInventory" }
  | { kind: "openCharacterSheet" }
  | { kind: "type"; char: string }
  | { kind: "backspace" }
  | { kind: "stepForward" | "stepBack" }
  | { kind: "turnLeft" | "turnRight" }
  | { kind: "openChest" }
  | { kind: "descend" }
  | { kind: "exitDungeon" }
  | { kind: "switchMode" }
  | { kind: "buy" | "sell" }
  | { kind: "equip" | "unequip" }
  | { kind: "cycleSort" }
  | { kind: "useItem" }
  | { kind: "hire" | "dismiss" }
  | { kind: "confirmYes" | "confirmNo" }
  | { kind: "shortcut"; char: string }
  | { kind: "deposit" | "withdraw" }
  | { kind: "chooseSwap" | "chooseDismantleDrop" };

export type Keymap = Partial<Record<KeyName, Intent>>;

export function resolveIntent(
  keymap: Keymap,
  key: KeyName,
): Intent | undefined {
  return keymap[key];
}

export function charFromKey(key: KeyName): string | undefined {
  if (key.startsWith("char:")) return key.slice("char:".length);
  if (key.startsWith("digit:")) return key.slice("digit:".length);

  if (key.length === 1) return key;
  return undefined;
}
