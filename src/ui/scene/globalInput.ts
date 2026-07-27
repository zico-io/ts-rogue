import type { Intent, Keymap, KeyName } from "./input";

export const globalKeymap: Keymap = {
  "digit:1": { kind: "changeScene", scene: "village" },
  "digit:2": { kind: "changeScene", scene: "overworld" },
  "digit:3": { kind: "changeScene", scene: "dungeon" },
  "digit:4": { kind: "changeScene", scene: "battle" },
  "`": { kind: "toggleConsole" },
  q: { kind: "quit" },
  "ctrl+c": { kind: "quit" },

  "char:z": { kind: "openZoom" },

  "char:v": { kind: "openInventory" },

  // Capital C so it does not collide with the village overview's lowercase
  // `c` (church) shortcut.
  "char:C": { kind: "openCharacterSheet" },
};

export function resolveGlobalIntent(key: KeyName): Intent | undefined {
  return globalKeymap[key];
}
