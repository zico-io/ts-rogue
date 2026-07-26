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
};

export function resolveGlobalIntent(key: KeyName): Intent | undefined {
  return globalKeymap[key];
}
