/**
 * Global input bindings (ROG-45): scene hotkeys, the dev-console toggle, and
 * quit. These fire regardless of which scene/screen owns focus, so `app.tsx`
 * (Ink) and the browser keyboard manager both resolve against the same
 * table instead of hand-rolling their own digit/quit maps.
 *
 * No imports from `ink`, `pixi.js`, `react`, or the DOM here.
 */

import type { Intent, Keymap, KeyName } from "./input";

export const globalKeymap: Keymap = {
  "digit:1": { kind: "changeScene", scene: "village" },
  "digit:2": { kind: "changeScene", scene: "overworld" },
  "digit:3": { kind: "changeScene", scene: "dungeon" },
  "digit:4": { kind: "changeScene", scene: "battle" },
  "`": { kind: "toggleConsole" },
  q: { kind: "quit" },
  "ctrl+c": { kind: "quit" },
  // ENG-1: opens the fast-travel picker. Handlers gate this to the
  // overworld/village scenes themselves (evac first inside a dungeon).
  "char:z": { kind: "openZoom" },
  // ENG-2: opens the Inventory screen. Not "char:i" - the village overview
  // already binds `i` to entering the Inn, and this fires globally
  // regardless of which village sub-view is open, so it needs a letter no
  // scene's local keymap claims. Handlers gate this to non-battle scenes.
  "char:v": { kind: "openInventory" },
};

/** Resolves the global `Intent` bound to a key press, if any. */
export function resolveGlobalIntent(key: KeyName): Intent | undefined {
  return globalKeymap[key];
}
