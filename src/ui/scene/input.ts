/**
 * Renderer-agnostic input types (ROG-55 RFC, ROG-56 core).
 *
 * `KeyName` is the normalized key alphabet every interpreter maps its raw
 * input events onto (Ink's `(input, key)` pair today; a DOM/pixi keyboard
 * event later). `Intent` is the renderer-agnostic action a key press means -
 * screens and reducers work in terms of intents, never raw keys, so the same
 * screen logic runs under any interpreter. A `Keymap` binds a subset of keys
 * to intents for a given view; `resolveIntent` looks one up.
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
  | { kind: "backspace" };

/** Binds a subset of `KeyName`s to intents for a given view. */
export type Keymap = Partial<Record<KeyName, Intent>>;

/** Looks up the intent bound to `key` in `keymap`, if any. */
export function resolveIntent(
  keymap: Keymap,
  key: KeyName,
): Intent | undefined {
  return keymap[key];
}
