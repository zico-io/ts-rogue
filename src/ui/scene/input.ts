/**
 * Renderer-agnostic input types (ROG-55 RFC, ROG-56 core; extended in
 * ROG-45 with the intents the dungeon/battle/village/overworld screens and
 * the global scene-hotkey/dev-console/quit bindings need).
 *
 * `KeyName` is the normalized key alphabet every interpreter maps its raw
 * input events onto (Ink's `(input, key)` pair today; a DOM keyboard event
 * for the browser renderer). `Intent` is the renderer-agnostic action a key
 * press means - screens and reducers work in terms of intents, never raw
 * keys, so the same screen logic runs under any interpreter. A `Keymap`
 * binds a subset of keys to intents for a given view; `resolveIntent` looks
 * one up.
 *
 * No imports from `ink`, `pixi.js`, `react`, or the DOM here.
 */

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
  | { kind: "type"; char: string }
  | { kind: "backspace" }
  // Dungeon: forward/back are relative to facing (not an absolute
  // direction), so they're distinct from `move`; turning is likewise
  // relative, distinct from the menu cursor's `menuLeft`/`menuRight`.
  | { kind: "stepForward" | "stepBack" }
  | { kind: "turnLeft" | "turnRight" }
  | { kind: "openChest" }
  | { kind: "descend" }
  | { kind: "exitDungeon" }
  // Village store/tavern: Tab flips a view's two-mode split.
  | { kind: "switchMode" }
  // Village store: buy/sell a shop item, equip/unequip a backpack item into
  // a party member's slot (sell is shared between the shop's stackable
  // items and the pack's generated items; the reducer disambiguates by mode).
  | { kind: "buy" | "sell" }
  | { kind: "equip" | "unequip" }
  // Village tavern: hire a recruit, dismiss a party member, and the
  // dismiss-confirmation's yes/no answer (distinct from the generic
  // `confirm`/`cancel` used for cursor selection and Escape).
  | { kind: "hire" | "dismiss" }
  | { kind: "confirmYes" | "confirmNo" }
  // Village overview: a direct single-letter jump to a menu option,
  // independent of cursor position (e.g. `i` opens the Inn from anywhere).
  | { kind: "shortcut"; char: string };

/** Binds a subset of `KeyName`s to intents for a given view. */
export type Keymap = Partial<Record<KeyName, Intent>>;

/** Looks up the intent bound to `key` in `keymap`, if any. */
export function resolveIntent(
  keymap: Keymap,
  key: KeyName,
): Intent | undefined {
  return keymap[key];
}
